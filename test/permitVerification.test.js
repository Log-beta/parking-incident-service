const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyPermit } = require("../src/services/permitVerification");
const valid = require("./fixtures/allocation-valid.json");

const presented = {
  reservationId: "res_123",
  vehiclePlate: "ABC123",
  spotId: "A1"
};

const invalid = {
  success: true,
  data: {
    reservation_id: "res_123",
    valid: false,
    spot_id: null,
    vehicle_plate: null
  }
};

const cases = [
  ["matching plate and spot", valid, presented, "verified"],
  ["spot omitted", valid, { reservationId: "res_123", vehiclePlate: "ABC123" }, "unverified"],
  ["different plate", valid, { ...presented, vehiclePlate: "XYZ789" }, "plate_mismatch"],
  ["different spot", valid, { ...presented, spotId: "A2" }, "spot_mismatch"],
  ["invalid reservation", invalid, presented, "invalid_reservation"],
  ["different reservation ID", valid, { ...presented, reservationId: "res_999" }, "unverified"],
  ["unavailable response", null, presented, "unverified"],
  ["malformed response", { success: true, data: {} }, presented, "unverified"]
];

for (const [scenario, response, input, expected] of cases) {
  test(`mocked Allocation: ${scenario} returns ${expected}`, () => {
    assert.equal(verifyPermit(response, input), expected);
  });
}
