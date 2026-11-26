const test = require("node:test");
const assert = require("node:assert/strict");
const { TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

process.env.INCIDENT_REPORTS_TABLE = "IncidentReportsTest";
process.env.INCIDENT_DUPLICATE_KEYS_TABLE = "IncidentDuplicateKeysTest";

const db = require("../src/config/dynamodb");
const { saveIncident } = require("../src/repositories/dynamodb/incidentRepository");
const { getIncidentDuplicateKey } = require("../src/services/incidentDuplicate");

test("saving an incident atomically claims its duplicate key for 10 minutes", async (t) => {
  const incident = {
    incident_id: "inc-1",
    user_id: "user-1",
    vehicle_plate: "ABC123",
    spot_id: "A1",
    incident_type: "unauthorized_parking",
    description: "Vehicle blocking bay A1",
    status: "open",
    created_at: new Date().toISOString()
  };

  const send = t.mock.method(db, "send", async () => ({}));
  const before = Math.floor(Date.now() / 1000);
  const saved = await saveIncident(incident);
  const after = Math.floor(Date.now() / 1000);

  assert.deepEqual(saved, incident);
  assert.equal(send.mock.callCount(), 1);

  const command = send.mock.calls[0].arguments[0];
  assert.ok(command instanceof TransactWriteCommand, "Expected one DynamoDB transaction");

  const writes = command.input.TransactItems;
  assert.equal(writes.length, 2);
  const claim = writes.find(entry => entry.Put?.TableName === "IncidentDuplicateKeysTest").Put;
  const report = writes.find(entry => entry.Put?.TableName === "IncidentReportsTest").Put;

  assert.equal(claim.Item.duplicate_key, getIncidentDuplicateKey(incident));
  assert.equal(claim.ConditionExpression, "attribute_not_exists(duplicate_key) OR expires_at <= :now");
  const now = claim.ExpressionAttributeValues[":now"];
  assert.ok(Number.isInteger(now) && now >= before && now <= after);
  assert.equal(claim.Item.expires_at, now + 600);

  assert.deepEqual(report.Item, incident);
  assert.equal(report.ConditionExpression, "attribute_not_exists(incident_id)");
});
test("duplicate-key condition failure is recognized as a duplicate incident", async (t) => {
  const incident = {
    incident_id: "inc-2",
    user_id: "user-1",
    vehicle_plate: "ABC123",
    spot_id: "A1",
    incident_type: "unauthorized_parking",
    description: "Vehicle blocking bay A1",
    status: "open",
    created_at: new Date().toISOString()
  };

  const cancellation = Object.assign(
    new Error("Transaction cancelled"),
    {
      name: "TransactionCanceledException",
      CancellationReasons: [
        { Code: "ConditionalCheckFailed" },
        { Code: "None" }
      ]
    }
  );

  const send = t.mock.method(db, "send", async () => {
    throw cancellation;
  });

  await assert.rejects(saveIncident(incident), {
    code: "DUPLICATE_INCIDENT"
  });

  assert.equal(send.mock.callCount(), 1);
});
const unrelatedFailures = [
  [
    "incident-ID collision",
    Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException",
      CancellationReasons: [
        { Code: "None" },
        { Code: "ConditionalCheckFailed" }
      ]
    })
  ],
  [
    "generic transaction cancellation",
    Object.assign(new Error("Transaction cancelled"), {
      name: "TransactionCanceledException"
    })
  ],
  [
    "database outage",
    new Error("Database unavailable")
  ]
];

for (const [scenario, failure] of unrelatedFailures) {
  test(`${scenario} is not classified as a duplicate incident`, async (t) => {
    const incident = {
      incident_id: "inc-3",
      user_id: "user-1",
      vehicle_plate: "ABC123",
      spot_id: "A1",
      incident_type: "unauthorized_parking",
      description: "Vehicle blocking bay A1",
      status: "open",
      created_at: new Date().toISOString()
    };

    const send = t.mock.method(db, "send", async () => {
      throw failure;
    });

    await assert.rejects(
      saveIncident(incident),
      (error) => {
        assert.strictEqual(error, failure);
        assert.notEqual(error.code, "DUPLICATE_INCIDENT");
        return true;
      }
    );

    assert.equal(send.mock.callCount(), 1);
  });
}
test("duplicate protection uses an inclusive expiry boundary", async (t) => {
  const now = 1800000000;

  t.mock.method(Date, "now", () => now * 1000);

  const incident = {
    incident_id: "inc-expiry",
    user_id: "user-1",
    vehicle_plate: "ABC123",
    spot_id: "A1",
    incident_type: "unauthorized_parking",
    description: "Vehicle blocking bay A1",
    status: "open",
    created_at: new Date().toISOString()
  };

  const send = t.mock.method(db, "send", async () => ({}));

  await saveIncident(incident);

  const claim = send.mock.calls[0].arguments[0]
    .input.TransactItems[0].Put;

  assert.equal(claim.ExpressionAttributeValues[":now"], now);
  assert.equal(claim.Item.expires_at, now + 600);
  assert.equal(
    claim.ConditionExpression,
    "attribute_not_exists(duplicate_key) OR expires_at <= :now"
  );
});
