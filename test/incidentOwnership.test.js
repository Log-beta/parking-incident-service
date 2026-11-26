const test = require("node:test");
const assert = require("node:assert/strict");
const { isReportOwner } = require("../src/services/incidentOwnership");

test("recognizes a report owned by the signed-in user", () => {
  assert.equal(isReportOwner({ user_id: "user-1" }, "user-1"), true);
});

test("rejects a report owned by another user", () => {
  assert.equal(isReportOwner({ user_id: "user-2" }, "user-1"), false);
});

test("rejects an older report with no owner", () => {
  assert.equal(isReportOwner({ incident_id: "legacy-1" }, "user-1"), false);
});

test("rejects a missing identity even when the report has no owner", () => {
  assert.equal(isReportOwner({}, undefined), false);
});
