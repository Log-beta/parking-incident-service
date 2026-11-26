const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIncident } = require("../src/validation/incidentValidation");

const validReport = {
  description: "Vehicle blocking bay A1",
  vehicle_plate: "ABC123",
  spot_id: "A1",
  incident_type: "unauthorized_parking"
};

const unsafeInputs = [
  ["description", "<script>alert(1)</script>"],
  ["description", "<img src=x onerror=alert(1)>"],
  ["vehicle_plate", "<b>ABC123</b>"],
  ["spot_id", "<iframe>"],
  ["incident_type", "<svg onload=alert(1)>"]
];

for (const [field, value] of unsafeInputs) {
  test(`${field} rejects HTML markup: ${value}`, () => {
    const report = { ...validReport, [field]: value };
    assert.equal(validateIncident(report)?.code, "UNSAFE_INPUT");
  });
}

test("legitimate punctuation remains accepted", () => {
  const report = {
    ...validReport,
    description: `Driver's vehicle blocked bays "A1" & "A2".`
  };

  assert.equal(validateIncident(report), null);
});
