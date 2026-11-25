const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const { randomUUID } = require("node:crypto");
const db = require("../../config/dynamodb");

const tableName =
  process.env.PERMIT_VERIFICATION_LOGS_TABLE || "PermitVerificationLogs";

async function savePermitVerification({
  reservationId,
  vehiclePlate,
  spotId,
  result
}) {
  const verification = {
    verification_id: randomUUID(),
    reservation_id: reservationId,
    vehicle_plate: vehiclePlate,
    result,
    created_at: new Date().toISOString()
  };

  if (spotId !== undefined) {
    verification.spot_id = spotId;
  }

  await db.send(new PutCommand({
    TableName: tableName,
    Item: verification,
    ConditionExpression: "attribute_not_exists(verification_id)"
  }));

  return verification;
}

module.exports = { savePermitVerification };