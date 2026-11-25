const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../src/config/dynamodb");

const {
  savePermitVerification
} = require("../src/repositories/dynamodb/permitVerificationRepository");

const outcomes = [
  "verified",
  "invalid_reservation",
  "plate_mismatch",
  "spot_mismatch",
  "unverified"
];

for (const result of outcomes) {
  test(`repository saves ${result} verification`, async (t) => {
    const mockSend = t.mock.method(db, "send", async () => ({}));

    const verification = await savePermitVerification({
      reservationId: "res_123",
      vehiclePlate: "ABC123",
      spotId: "A1",
      result
    });

    assert.ok(verification.verification_id);
    assert.equal(verification.reservation_id, "res_123");
    assert.equal(verification.vehicle_plate, "ABC123");
    assert.equal(verification.spot_id, "A1");
    assert.equal(verification.result, result);
    assert.ok(!Number.isNaN(Date.parse(verification.created_at)));

    assert.equal(mockSend.mock.callCount(), 1);

    const command = mockSend.mock.calls[0].arguments[0];

    assert.equal(
      command.input.TableName,
      process.env.PERMIT_VERIFICATION_LOGS_TABLE ||
        "PermitVerificationLogs"
    );

    assert.deepEqual(command.input.Item, verification);

    assert.equal(
      command.input.ConditionExpression,
      "attribute_not_exists(verification_id)"
    );
  });
}

test("repository omits optional spot_id when not provided", async (t) => {
  t.mock.method(db, "send", async () => ({}));

  const verification = await savePermitVerification({
    reservationId: "res_123",
    vehiclePlate: "ABC123",
    result: "verified"
  });

  assert.equal(Object.hasOwn(verification, "spot_id"), false);
});

test("repository propagates database errors", async (t) => {
  t.mock.method(db, "send", async () => {
    throw new Error("Database unavailable");
  });

  await assert.rejects(
    savePermitVerification({
      reservationId: "res_123",
      vehiclePlate: "ABC123",
      spotId: "A1",
      result: "verified"
    }),
    /Database unavailable/
  );
});