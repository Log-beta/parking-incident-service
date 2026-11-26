const test = require("node:test");
const assert = require("node:assert/strict");
const { auditLog } = require("../src/utils/auditLogger");

test("audit logger produces structured JSON records", (t) => {
  const logMock = t.mock.method(console, "log", () => {});

  const record = auditLog("INCIDENT_CREATED", {
    userId: "student1",
    incidentId: "incident-123",
    outcome: "success"
  });

  assert.equal(record.event, "INCIDENT_CREATED");
  assert.equal(record.service, "parking-incidents");
  assert.equal(record.userId, "student1");
  assert.equal(record.incidentId, "incident-123");
  assert.equal(record.outcome, "success");
  assert.ok(Number.isFinite(Date.parse(record.timestamp)));

  assert.equal(logMock.mock.callCount(), 1);

  const output = logMock.mock.calls[0].arguments[0];
  assert.deepEqual(JSON.parse(output), record);
});

test("audit logger excludes sensitive and unsupported fields", (t) => {
  t.mock.method(console, "log", () => {});

  const record = auditLog("AUTH_FAILURE", {
    outcome: "denied",
    password: "test-password",
    token: "test-token",
    authorization: "Bearer test-token",
    secret: "test-secret",
    description: "private incident description",
    body: { private: true },
    headers: { Authorization: "Bearer test-token" }
  });

  for (const field of [
    "password",
    "token",
    "authorization",
    "secret",
    "description",
    "body",
    "headers"
  ]) {
    assert.equal(Object.hasOwn(record, field), false);
  }

  assert.equal(record.outcome, "denied");
});
