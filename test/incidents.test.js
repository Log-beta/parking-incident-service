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
