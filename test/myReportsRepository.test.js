const test = require("node:test");
const assert = require("node:assert/strict");
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
const db = require("../src/config/dynamodb");
const { listIncidentsByOwner } = require("../src/repositories/dynamodb/incidentRepository");

test("My Reports queries the owner index newest first and returns the next page key", async (t) => {
  const report = {
    incident_id: "inc-1",
    user_id: "user-1",
    created_at: "2026-11-25T12:00:00.000Z"
  };
  const lastKey = { ...report };

  const query = t.mock.method(db, "send", async (command) => {
    assert.ok(command instanceof QueryCommand);
    assert.equal(command.input.IndexName, "user_id-created_at-index");
    assert.equal(command.input.KeyConditionExpression, "user_id = :owner");
    assert.equal(command.input.ExpressionAttributeValues[":owner"], "user-1");
    assert.equal(command.input.ScanIndexForward, false);
    assert.equal(command.input.Limit, 25);
    return { Items: [report], LastEvaluatedKey: lastKey };
  });

  const page = await listIncidentsByOwner("user-1");
  assert.equal(query.mock.callCount(), 1);
  assert.deepEqual(page, { items: [report], lastEvaluatedKey: lastKey });
});
