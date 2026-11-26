const test = require("node:test");
const assert = require("node:assert/strict");
const { getIncidentDuplicateKey } = require("../src/services/incidentDuplicate");

const report = {
  incident_id: "inc-1",
  created_at: "2026-11-26T12:00:00.000Z",
  user_id: "user-1",
  vehicle_plate: "ABC123",
  spot_id: "A1",
  incident_type: "unauthorized_parking",
  description: "Vehicle blocking bay A1"
};

test("a retry keeps the same key despite a new ID, timestamp, or surrounding spaces", () => {
  const retry = {
    ...report,
    incident_id: "inc-2",
    created_at: "2026-11-26T12:01:00.000Z",
    vehicle_plate: " ABC123 ",
    spot_id: " A1 ",
    incident_type: " unauthorized_parking ",
    description: " Vehicle blocking bay A1 "
  };
  assert.equal(getIncidentDuplicateKey(retry), getIncidentDuplicateKey(report));
});

const changes = {
  user_id: "user-2",
  vehicle_plate: "abc123",
  spot_id: "a1",
  incident_type: "blocked_exit",
  description: "Vehicle blocking the exit"
};

for (const [field, value] of Object.entries(changes)) {
  test(`changing ${field} produces a different duplicate key`, () => {
    const changed = { ...report, [field]: value };
    assert.notEqual(getIncidentDuplicateKey(changed), getIncidentDuplicateKey(report));
  });
}
