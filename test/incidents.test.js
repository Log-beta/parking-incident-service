const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { once } = require("node:events");
const jwt = require("jsonwebtoken");

const { generateKeyPairSync } = require("node:crypto");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048
});

process.env.COGNITO_ISSUER = "https://example.test/cognito";
process.env.COGNITO_CLIENT_ID = "test-parking";
process.env.COGNITO_JWKS_URL = "https://example.test/jwks";

const kid = "incidents-integration-test-key";

const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid,
  alg: "RS256",
  use: "sig"
};

process.env.COGNITO_USERS_JSON = JSON.stringify({
  "user-1": { user_id: "user-1", priority: 1 },
  "user-2": { user_id: "user-2", priority: 1 },
  "admin-1": { user_id: "admin-1", priority: 1 },
  "admin-2": { user_id: "admin-2", priority: 1 }
});

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, options) => {
  if (input === process.env.COGNITO_JWKS_URL) {
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  return originalFetch(input, options);
};

after(() => {
  globalThis.fetch = originalFetch;
});

function createCognitoToken({ sub, role }) {
  return jwt.sign({
    sub,
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": [role]
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: "5m"
  });
}

const app = require("../index");
let server;
let url;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${server.address().port}/api/incidents`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function submitEmptyReport(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
}

test("POST /api/incidents requires authentication before validating the report", async () => {
  const response = await submitEmptyReport();
  assert.equal(response.status, 401);
});

test("POST /api/incidents rejects a missing description for a signed-in user", async () => {
  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await submitEmptyReport(token);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "DESCRIPTION_REQUIRED",
      message: "A description is required."
    }
  });
});

test("POST /api/incidents stores the signed-in user as owner when the body names another user", async (t) => {
  const db = require("../src/config/dynamodb");
  const { TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");
  const writes = [];

  t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof TransactWriteCommand);
    const items = command.input.TransactItems;
    assert.equal(items.length, 2);
    assert.ok(items[0].Put.Item.duplicate_key);
    assert.ok(items[1].Put.Item.incident_id);
    writes.push(items[1].Put.Item);
    return {};
  });

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      user_id: "user-2",
      description: "Vehicle blocking bay A1",
      vehicle_plate: "ABC123",
      spot_id: "A1",
      incident_type: "unauthorized_parking"
    })
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].user_id, "user-1");
  assert.equal(body.data.user_id, "user-1");
  assert.equal(body.data.incident_id, writes[0].incident_id);
});

test("GET /api/incidents/:id requires authentication before reading DynamoDB", async (t) => {
  const db = require("../src/config/dynamodb");
  const read = t.mock.method(db, "send", async () => ({}));

  const response = await fetch(`${url}/test-incident`);

  assert.equal(response.status, 401);
  assert.equal(read.mock.callCount(), 0);
});

const ownedReport = {
  incident_id: "incident-ownership-test",
  user_id: "user-1",
  description: "Vehicle blocking bay A1"
};

for (const [userId, expectedStatus] of [["user-1", 200], ["user-2", 404]]) {
  test(`GET incident owned by user-1 returns ${expectedStatus} for ${userId}`, async (t) => {
    const db = require("../src/config/dynamodb");
    t.mock.method(db, "send", async () => ({ Item: ownedReport }));

    const token = createCognitoToken({ sub: userId, role: "user" });

    const response = await fetch(`${url}/${ownedReport.incident_id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(response.status, expectedStatus);
    const body = await response.json();

    if (expectedStatus === 200) {
      assert.deepEqual(body, { success: true, data: ownedReport });
    } else {
      assert.deepEqual(body, {
        success: false,
        error: { code: "INCIDENT_NOT_FOUND", message: "Incident report not found." }
      });
    }
  });
}

test("GET /api/incidents lists reports for the signed-in user even if another user_id is supplied", async (t) => {
  const db = require("../src/config/dynamodb");
  const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
  const report = { incident_id: "inc-1", user_id: "user-1" };

  const query = t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.ExpressionAttributeValues[":owner"], "user-1");
    return { Items: [report] };
  });

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(`${url}?user_id=user-2`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(response.status, 200);
  assert.equal(query.mock.callCount(), 1);
  assert.deepEqual(await response.json(), {
    success: true,
    data: { items: [report], next_cursor: null }
  });
});

test("My Reports uses the returned cursor to fetch the next page", async (t) => {
  const db = require("../src/config/dynamodb");
  const newer = {
    incident_id: "inc-newer", user_id: "user-1", created_at: "2026-11-25T12:00:00.000Z"
  };
  const older = {
    incident_id: "inc-older", user_id: "user-1", created_at: "2026-11-24T12:00:00.000Z"
  };

  const query = t.mock.method(db, "send", async (command) => {
    assert.equal(command.input.ExpressionAttributeValues[":owner"], "user-1");
    if (command.input.ExclusiveStartKey === undefined) {
      return { Items: [newer], LastEvaluatedKey: newer };
    }
    assert.deepEqual(command.input.ExclusiveStartKey, newer);
    return { Items: [older] };
  });

  const token = createCognitoToken({ sub: "user-1", role: "user" });
  const headers = { Authorization: `Bearer ${token}` };

  const first = await fetch(url, { headers });
  assert.equal(first.status, 200);
  const { data } = await first.json();
  assert.deepEqual(data.items, [newer]);
  assert.ok(typeof data.next_cursor === "string" && data.next_cursor.length > 0);

  const second = await fetch(`${url}?cursor=${encodeURIComponent(data.next_cursor)}`, { headers });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {
    success: true,
    data: { items: [older], next_cursor: null }
  });
  assert.equal(query.mock.callCount(), 2);
});

test("a regular user cannot change an incident status", async (t) => {
  const db = require("../src/config/dynamodb");
  const databaseCall = t.mock.method(db, "send", async () => ({}));

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(`${url}/inc-1/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "under_review" })
  });

  assert.equal(response.status, 403);
  assert.equal(databaseCall.mock.callCount(), 0);
});

test("an admin can move an open incident under review", async (t) => {
  const logMock = t.mock.method(console, "log", () => {});
  const db = require("../src/config/dynamodb");
  const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");

  const write = t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof UpdateCommand);
    assert.deepEqual(command.input.Key, { incident_id: "inc-1" });

    const values = command.input.ExpressionAttributeValues;
    assert.equal(values[":from"], "open");
    assert.equal(values[":to"], "under_review");
    assert.equal(values[":actor"], "admin-1");
    assert.match(command.input.ConditionExpression, /#status\s*=\s*:from/);

    return {
      Attributes: {
        incident_id: "inc-1",
        status: values[":to"],
        updated_by: values[":actor"]
      }
    };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });

  const response = await fetch(`${url}/inc-1/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "under_review" })
  });

  assert.equal(response.status, 200);
  assert.equal(write.mock.callCount(), 1);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "under_review");
  assert.equal(body.data.updated_by, "admin-1");

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "INCIDENT_REVIEW_STARTED"
  );

  assert.ok(record);
  assert.equal(record.userId, "admin-1");
  assert.equal(record.role, "admin");
  assert.equal(record.incidentId, "inc-1");
  assert.equal(record.previousStatus, "open");
  assert.equal(record.newStatus, "under_review");
  assert.equal(record.statusCode, 200);
  assert.equal(record.outcome, "success");
  assert.ok(!JSON.stringify(records).includes(token));
});

const reviewConflicts = [
  ["missing incident", null, 404, "INCIDENT_NOT_FOUND"],
  ["incident already under review", { incident_id: "inc-1", status: "under_review" }, 409, "STATUS_CONFLICT"]
];

for (const [scenario, existing, expectedStatus, expectedCode] of reviewConflicts) {
  test(`starting a review returns ${expectedStatus} for ${scenario}`, async (t) => {
    const db = require("../src/config/dynamodb");
    const { UpdateCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

    const calls = t.mock.method(db, "send", async (command) => {
      assert.deepEqual(command.input.Key, { incident_id: "inc-1" });
      if (command instanceof UpdateCommand) {
        const error = new Error("The incident was not open");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }

      assert.ok(command instanceof GetCommand);
      return existing ? { Item: existing } : {};
    });

    const token = createCognitoToken({ sub: "admin-2", role: "admin" });

    const response = await fetch(`${url}/inc-1/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "under_review" })
    });

    assert.equal(response.status, expectedStatus);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, expectedCode);
    assert.equal(calls.mock.callCount(), 2);
  });
}

test("resolving an incident requires a nonblank resolution note", async (t) => {
  const db = require("../src/config/dynamodb");
  const databaseCall = t.mock.method(db, "send", async () => ({}));

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });

  const response = await fetch(`${url}/inc-1/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "resolved", resolution_notes: "   " })
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "RESOLUTION_NOTES_REQUIRED");
  assert.equal(databaseCall.mock.callCount(), 0);
});

test("an admin resolves an incident under review with trimmed notes and an audit timestamp", async (t) => {
  const logMock = t.mock.method(console, "log", () => {});
  const db = require("../src/config/dynamodb");
  const { UpdateCommand } = require("@aws-sdk/lib-dynamodb");
  const note = "Vehicle moved and bay A1 is clear.";

  const write = t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof UpdateCommand);
    const input = command.input;
    const values = input.ExpressionAttributeValues;

    assert.deepEqual(input.Key, { incident_id: "inc-1" });
    assert.equal(input.ExpressionAttributeNames["#status"], "status");
    assert.equal(input.ConditionExpression, "#status = :from");
    assert.equal(values[":from"], "under_review");
    assert.equal(values[":to"], "resolved");
    assert.equal(values[":notes"], note);
    assert.equal(values[":actor"], "admin-1");
    assert.equal(new Date(values[":now"]).toISOString(), values[":now"]);
    assert.match(input.UpdateExpression, /#status\s*=\s*:to/);
    assert.match(input.UpdateExpression, /resolution_notes\s*=\s*:notes/);
    assert.match(input.UpdateExpression, /resolved_by\s*=\s*:actor/);
    assert.match(input.UpdateExpression, /resolved_at\s*=\s*:now/);
    assert.equal(input.ReturnValues, "ALL_NEW");

    return { Attributes: {
      incident_id: "inc-1",
      status: "resolved",
      resolution_notes: values[":notes"],
      resolved_by: values[":actor"],
      resolved_at: values[":now"]
    } };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });

  const response = await fetch(`${url}/inc-1/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      status: "resolved",
      resolution_notes: `  ${note}  `,
      resolved_by: "someone-else"
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.status, "resolved");
  assert.equal(body.data.resolution_notes, note);
  assert.equal(body.data.resolved_by, "admin-1");
  assert.equal(write.mock.callCount(), 1);

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "INCIDENT_RESOLVED"
  );

  assert.ok(record);
  assert.equal(record.userId, "admin-1");
  assert.equal(record.role, "admin");
  assert.equal(record.incidentId, "inc-1");
  assert.equal(record.previousStatus, "under_review");
  assert.equal(record.newStatus, "resolved");
  assert.equal(record.statusCode, 200);
  assert.equal(record.outcome, "success");
  assert.ok(!JSON.stringify(records).includes(token));
  assert.ok(!JSON.stringify(records).includes(note));
});

test("a regular user cannot list reports through the admin dashboard", async (t) => {
  const db = require("../src/config/dynamodb");
  const databaseCall = t.mock.method(db, "send", async () => ({}));

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(`${url}/admin/reports?status=open`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "ADMIN_REQUIRED");
  assert.equal(databaseCall.mock.callCount(), 0);
});

test("an admin can list open incidents across owners", async (t) => {
  const db = require("../src/config/dynamodb");
  const reports = [
    { incident_id: "inc-1", user_id: "user-1", status: "open" },
    { incident_id: "inc-2", user_id: "user-2", status: "open" },
    { incident_id: "inc-3", user_id: "user-2", status: "resolved" }
  ];

  const read = t.mock.method(db, "send", async (command) => {
    const input = command.input;
    assert.equal(input.FilterExpression, "#status = :status");
    assert.equal(input.ExpressionAttributeNames["#status"], "status");
    assert.equal(input.ExpressionAttributeValues[":status"], "open");
    return { Items: reports.filter(report => report.status === "open") };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });

  const response = await fetch(`${url}/admin/reports?status=open`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(response.status, 200);
  assert.equal(read.mock.callCount(), 1);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data.items, [reports[0], reports[1]]);
  assert.equal(body.data.next_cursor, null);
});

test("an admin can continue past an empty filtered page to find an open report", async (t) => {
  const db = require("../src/config/dynamodb");
  const lastKey = { incident_id: "inc-last-evaluated" };
  const openReport = { incident_id: "inc-open", user_id: "user-2", status: "open" };

  const read = t.mock.method(db, "send", async (command) => {
    assert.equal(command.input.ExpressionAttributeValues[":status"], "open");

    if (command.input.ExclusiveStartKey === undefined) {
      return { Items: [], LastEvaluatedKey: lastKey };
    }

    assert.deepEqual(command.input.ExclusiveStartKey, lastKey);
    return { Items: [openReport] };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });
  const headers = { Authorization: `Bearer ${token}` };
  const endpoint = `${url}/admin/reports?status=open`;

  const first = await fetch(endpoint, { headers });
  assert.equal(first.status, 200);
  const firstPage = (await first.json()).data;
  assert.deepEqual(firstPage.items, []);
  assert.ok(typeof firstPage.next_cursor === "string" && firstPage.next_cursor.length > 0);

  const second = await fetch(`${endpoint}&cursor=${encodeURIComponent(firstPage.next_cursor)}`, { headers });
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).data, { items: [openReport], next_cursor: null });
  assert.equal(read.mock.callCount(), 2);
});

test("an admin can search incident reports by exact vehicle plate", async (t) => {
  const db = require("../src/config/dynamodb");
  const matching = { incident_id: "inc-1", user_id: "user-1", vehicle_plate: "ABC123" };
  const other = { incident_id: "inc-2", user_id: "user-2", vehicle_plate: "XYZ789" };

  const read = t.mock.method(db, "send", async (command) => {
    const plate = command.input.ExpressionAttributeValues?.[":plate"];
    const items = [matching, other];
    return { Items: plate === undefined ? items : items.filter(item => item.vehicle_plate === plate) };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });

  const response = await fetch(`${url}/admin/reports?vehicle_plate=ABC123`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.items, [matching]);

  const input = read.mock.calls[0].arguments[0].input;
  assert.equal(input.ExpressionAttributeNames["#plate"], "vehicle_plate");
  assert.equal(input.FilterExpression, "#plate = :plate");
});

test("admin search combines status and plate and rejects a cursor after the plate changes", async (t) => {
  const db = require("../src/config/dynamodb");
  const read = t.mock.method(db, "send", async (command) => {
    const input = command.input;
    assert.equal(input.FilterExpression, "#status = :status AND #plate = :plate");
    assert.deepEqual(input.ExpressionAttributeValues, {
      ":status": "open",
      ":plate": "ABC123"
    });
    return { Items: [], LastEvaluatedKey: { incident_id: "inc-25" } };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });
  const headers = { Authorization: `Bearer ${token}` };
  const endpoint = `${url}/admin/reports`;

  const first = await fetch(`${endpoint}?status=open&vehicle_plate=ABC123`, { headers });
  assert.equal(first.status, 200);
  const { data } = await first.json();
  assert.ok(data.next_cursor);

  const changed = new URLSearchParams({
    status: "open",
    vehicle_plate: "XYZ789",
    cursor: data.next_cursor
  });
  const second = await fetch(`${endpoint}?${changed}`, { headers });

  assert.equal(second.status, 400);
  assert.equal((await second.json()).error.code, "INVALID_CURSOR");
  assert.equal(read.mock.callCount(), 1);
});

test("an admin can filter incident reports by exact parking spot", async (t) => {
  const db = require("../src/config/dynamodb");
  const reports = [
    { incident_id: "inc-1", spot_id: "A1" },
    { incident_id: "inc-2", spot_id: "A2" }
  ];

  const read = t.mock.method(db, "send", async (command) => {
    const spot = command.input.ExpressionAttributeValues?.[":spot"];
    return {
      Items: spot === undefined ? reports : reports.filter(report => report.spot_id === spot)
    };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });

  const response = await fetch(`${url}/admin/reports?spot_id=A1`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.items, [reports[0]]);

  const input = read.mock.calls[0].arguments[0].input;
  assert.equal(input.ExpressionAttributeNames["#spot"], "spot_id");
  assert.equal(input.FilterExpression, "#spot = :spot");
});

test("admin search combines status, plate and spot and rejects a cursor from another spot", async (t) => {
  const db = require("../src/config/dynamodb");
  const read = t.mock.method(db, "send", async (command) => {
    const input = command.input;
    assert.equal(input.FilterExpression, "#status = :status AND #plate = :plate AND #spot = :spot");
    assert.deepEqual(input.ExpressionAttributeValues, {
      ":status": "resolved",
      ":plate": "TEST123",
      ":spot": "A1"
    });
    return { Items: [], LastEvaluatedKey: { incident_id: "inc-25" } };
  });

  const token = createCognitoToken({ sub: "admin-1", role: "admin" });
  const headers = { Authorization: `Bearer ${token}` };
  const endpoint = `${url}/admin/reports`;
  const params = new URLSearchParams({
    status: "resolved", vehicle_plate: "TEST123", spot_id: "A1"
  });

  const first = await fetch(`${endpoint}?${params}`, { headers });
  assert.equal(first.status, 200);
  const { data } = await first.json();
  assert.ok(data.next_cursor);

  params.set("cursor", data.next_cursor);
  params.set("spot_id", "A2");
  const second = await fetch(`${endpoint}?${params}`, { headers });

  assert.equal(second.status, 400);
  assert.equal((await second.json()).error.code, "INVALID_CURSOR");
  assert.equal(read.mock.callCount(), 1);
});
test("POST /api/incidents returns 409 for a duplicate incident", async (t) => {
  const db = require("../src/config/dynamodb");
  const { TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

  const write = t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof TransactWriteCommand);

    throw Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [
        { Code: "ConditionalCheckFailed" },
        { Code: "None" }
      ]
    });
  });

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      description: "Vehicle blocking bay A1",
      vehicle_plate: "ABC123",
      spot_id: "A1",
      incident_type: "unauthorized_parking"
    })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "DUPLICATE_INCIDENT",
      message: "An identical incident was submitted within the last 10 minutes."
    }
  });

  assert.equal(write.mock.callCount(), 1);
});
test("API responses include essential security headers", async () => {
  const response = await fetch(
    url.replace("/api/incidents", "/health")
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.ok(response.headers.get("content-security-policy"));
});

test("rejected requests also include security headers", async () => {
  const response = await submitEmptyReport();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.get("content-security-policy"));
});

test("POST /api/incidents rejects oversized descriptions before accessing DynamoDB", async (t) => {
  const db = require("../src/config/dynamodb");
  const databaseCall = t.mock.method(db, "send", async () => ({}));

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      description: "A".repeat(501),
      vehicle_plate: "ABC123",
      spot_id: "A1",
      incident_type: "unauthorized_parking"
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "DESCRIPTION_TOO_LONG",
      message: "Description must not exceed 500 characters."
    }
  });

  assert.equal(databaseCall.mock.callCount(), 0);
});

test("POST /api/incidents rejects unsafe input before accessing DynamoDB", async (t) => {
  const db = require("../src/config/dynamodb");
  const databaseCall = t.mock.method(db, "send", async () => ({}));

  const token = createCognitoToken({ sub: "user-1", role: "user" });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      description: "<script>alert(1)</script>",
      vehicle_plate: "ABC123",
      spot_id: "A1",
      incident_type: "unauthorized_parking"
    })
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "UNSAFE_INPUT",
      message: "HTML markup and angle brackets are not allowed in incident fields."
    }
  });

  assert.equal(databaseCall.mock.callCount(), 0);
});

test("malformed JSON returns a safe JSON error without exposing stack traces", async () => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: '{"description":'
  });

  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/);

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "INVALID_JSON",
      message: "Request body contains invalid JSON."
    }
  });
});

test("oversized request body returns a safe JSON error", async () => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      description: "a".repeat(200000)
    })
  });

  assert.equal(response.status, 413);
  assert.match(response.headers.get("content-type"), /application\/json/);

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the allowed size."
    }
  });
});

test("unknown endpoint returns a safe JSON error", async () => {
  const response = await fetch(`${url}/nonexistent/endpoint`);

  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type"), /application\/json/);

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "ENDPOINT_NOT_FOUND",
      message: "The requested endpoint does not exist."
    }
  });
});

test("API rejects legacy HS256 authentication tokens", async () => {
  const token = jwt.sign({
    sub: "user-1",
    role: "admin",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["admin"]
  }, "test-only-legacy-secret", {
    algorithm: "HS256",
    expiresIn: "5m"
  });

  const response = await submitEmptyReport(token);

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("www-authenticate"),
    "Bearer"
  );

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid access token is required."
    }
  });
});

test("API rejects unmapped Cognito users", async () => {
  const token = createCognitoToken({
    sub: "unregistered-cognito-user",
    role: "user"
  });

  const response = await submitEmptyReport(token);

  assert.equal(response.status, 401);

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid access token is required."
    }
  });
});

test("API rejects Cognito ID tokens", async () => {
  const token = jwt.sign({
    sub: "user-1",
    iss: process.env.COGNITO_ISSUER,
    aud: process.env.COGNITO_CLIENT_ID,
    token_use: "id",
    "cognito:groups": ["user"]
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: "5m"
  });

  const response = await submitEmptyReport(token);

  assert.equal(response.status, 401);

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid access token is required."
    }
  });
});

test("API rejects conflicting Cognito roles", async () => {
  const token = jwt.sign({
    sub: "user-1",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["user", "admin"]
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: "5m"
  });

  const response = await fetch(`${url}/admin/reports`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  assert.equal(response.status, 401);

  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid access token is required."
    }
  });
});

test("API returns 503 when Cognito configuration is missing", async () => {
  const token = createCognitoToken({
    sub: "user-1",
    role: "user"
  });

  const originalIssuer = process.env.COGNITO_ISSUER;

  try {
    delete process.env.COGNITO_ISSUER;

    const response = await submitEmptyReport(token);

    assert.equal(response.status, 503);

    assert.deepEqual(await response.json(), {
      success: false,
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is unavailable."
      }
    });
  } finally {
    process.env.COGNITO_ISSUER = originalIssuer;
  }
});

test("rejected authentication generates a safe audit event", async (t) => {
  const logMock = t.mock.method(console, "log", () => {});

  const response = await submitEmptyReport("invalid-test-token");

  assert.equal(response.status, 401);

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "AUTH_FAILURE"
  );

  assert.ok(record);
  assert.equal(record.statusCode, 401);
  assert.equal(record.outcome, "denied");
  assert.equal(record.reason, "INVALID_CREDENTIALS");

  assert.ok(
    !JSON.stringify(records).includes("invalid-test-token")
  );
});

test("administrator access denial generates an audit event", async (t) => {
  const logMock = t.mock.method(console, "log", () => {});

  const token = createCognitoToken({
    sub: "user-1",
    role: "user"
  });

  const response = await fetch(`${url}/admin/reports`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  assert.equal(response.status, 403);

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "ADMIN_ACCESS_DENIED"
  );

  assert.ok(record);
  assert.equal(record.userId, "user-1");
  assert.equal(record.role, "user");
  assert.equal(record.statusCode, 403);
  assert.equal(record.outcome, "denied");
  assert.equal(record.reason, "ADMIN_REQUIRED");

  assert.ok(!JSON.stringify(records).includes(token));
});

test("incident ownership denial generates an audit event", async (t) => {
  const db = require("../src/config/dynamodb");

  t.mock.method(db, "send", async () => ({
    Item: {
      incident_id: "incident-audit-test",
      user_id: "user-1",
      status: "open"
    }
  }));

  const logMock = t.mock.method(console, "log", () => {});

  const token = createCognitoToken({
    sub: "user-2",
    role: "user"
  });

  const response = await fetch(`${url}/incident-audit-test`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  assert.equal(response.status, 404);

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "INCIDENT_ACCESS_DENIED"
  );

  assert.ok(record);
  assert.equal(record.userId, "user-2");
  assert.equal(record.statusCode, 404);
  assert.equal(record.outcome, "denied");
  assert.equal(record.reason, "OWNERSHIP_MISMATCH");

  assert.ok(!JSON.stringify(records).includes(token));
  assert.ok(!JSON.stringify(records).includes("user-1"));
});

test("successful incident creation generates a safe audit event", async (t) => {
  const db = require("../src/config/dynamodb");

  t.mock.method(db, "send", async () => ({}));

  const logMock = t.mock.method(console, "log", () => {});

  const token = createCognitoToken({
    sub: "user-1",
    role: "user"
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      description: "Private incident description",
      vehicle_plate: "AUDIT123",
      spot_id: "A1",
      incident_type: "unauthorized_parking"
    })
  });

  assert.equal(response.status, 201);

  const body = await response.json();

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "INCIDENT_CREATED"
  );

  assert.ok(record);
  assert.equal(record.userId, "user-1");
  assert.equal(record.role, "user");
  assert.equal(record.incidentId, body.data.incident_id);
  assert.equal(record.statusCode, 201);
  assert.equal(record.outcome, "success");

  const output = JSON.stringify(records);

  assert.ok(!output.includes(token));
  assert.ok(!output.includes("AUDIT123"));
  assert.ok(!output.includes("Private incident description"));
});

test("duplicate incident rejection generates a safe audit event", async (t) => {
  const db = require("../src/config/dynamodb");

  t.mock.method(db, "send", async () => {
    const error = new Error("Transaction cancelled");
    error.name = "TransactionCanceledException";
    error.CancellationReasons = [
      { Code: "ConditionalCheckFailed" },
      { Code: "None" }
    ];
    throw error;
  });

  const logMock = t.mock.method(console, "log", () => {});

  const token = createCognitoToken({
    sub: "user-1",
    role: "user"
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      description: "Private duplicate description",
      vehicle_plate: "DUP123",
      spot_id: "A1",
      incident_type: "unauthorized_parking"
    })
  });

  assert.equal(response.status, 409);

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const record = records.find(
    entry => entry.event === "DUPLICATE_INCIDENT_REJECTED"
  );

  assert.ok(record);
  assert.equal(record.userId, "user-1");
  assert.equal(record.role, "user");
  assert.equal(record.statusCode, 409);
  assert.equal(record.outcome, "denied");
  assert.equal(record.reason, "DUPLICATE_INCIDENT");

  const output = JSON.stringify(records);

  assert.ok(!output.includes(token));
  assert.ok(!output.includes("DUP123"));
  assert.ok(!output.includes("Private duplicate description"));
});
