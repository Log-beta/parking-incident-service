const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { once } = require("node:events");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.JWT_ISSUER = "test-allocation";
process.env.JWT_AUDIENCE = "test-parking";

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
  const token = jwt.sign({ sub: "user-1", role: "user" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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
  const { PutCommand } = require("@aws-sdk/lib-dynamodb");
  const writes = [];

  t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof PutCommand);
    writes.push(command.input.Item);
    return {};
  });

  const token = jwt.sign({ sub: "user-1", role: "user" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

    const token = jwt.sign({ sub: userId, role: "user" }, process.env.JWT_SECRET, {
      algorithm: "HS256",
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: "5m"
    });

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

  const token = jwt.sign({ sub: "user-1", role: "user" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

  const token = jwt.sign({ sub: "user-1", role: "user" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });
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

  const token = jwt.sign({ sub: "user-1", role: "user" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

  const token = jwt.sign({ sub: "admin-1", role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

    const token = jwt.sign({ sub: "admin-2", role: "admin" }, process.env.JWT_SECRET, {
      algorithm: "HS256",
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: "5m"
    });

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

  const token = jwt.sign({ sub: "admin-1", role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

  const token = jwt.sign({ sub: "admin-1", role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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
});

test("a regular user cannot list reports through the admin dashboard", async (t) => {
  const db = require("../src/config/dynamodb");
  const databaseCall = t.mock.method(db, "send", async () => ({}));

  const token = jwt.sign({ sub: "user-1", role: "user" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

  const token = jwt.sign({ sub: "admin-1", role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });

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

  const token = jwt.sign({ sub: "admin-1", role: "admin" }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: "5m"
  });
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
