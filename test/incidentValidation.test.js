const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIncident } = require("../src/validation/incidentValidation");

const validReport = {
  description: "Vehicle parked in bay A1 without a visible permit",
  vehicle_plate: "ABC123",
  spot_id: "A1",
  incident_type: "unauthorized_parking"
};

const cases = [
  ["vehicle_plate", "VEHICLE_PLATE_REQUIRED"],
  ["spot_id", "SPOT_ID_REQUIRED"],
  ["incident_type", "INCIDENT_TYPE_REQUIRED"]
];

for (const [field, expectedCode] of cases) {
  test(`validator rejects a report missing ${field}`, () => {
    const report = { ...validReport };
    delete report[field];

    const error = validateIncident(report);
    assert.equal(error?.code, expectedCode);
  });
}
