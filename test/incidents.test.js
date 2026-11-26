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
