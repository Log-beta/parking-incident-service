const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIncident } = require("../src/validation/incidentValidation");

const validReport = {
  description: "Vehicle blocking bay A1",
  vehicle_plate: "ABC123",
  spot_id: "A1",
  incident_type: "unauthorized_parking"
};

const limits = [
  ["description", 500, "DESCRIPTION_TOO_LONG"],
  ["vehicle_plate", 20, "VEHICLE_PLATE_TOO_LONG"],
  ["spot_id", 50, "SPOT_ID_TOO_LONG"],
  ["incident_type", 50, "INCIDENT_TYPE_TOO_LONG"]
];

for (const [field, max, code] of limits) {
  test(`${field} rejects input exceeding ${max} characters`, () => {
    const report = {
      ...validReport,
      [field]: "A".repeat(max + 1)
    };

    assert.equal(validateIncident(report)?.code, code);
  });

  test(`${field} accepts exactly ${max} characters`, () => {
    const report = {
      ...validReport,
      [field]: "A".repeat(max)
    };

    assert.equal(validateIncident(report), null);
  });
}
