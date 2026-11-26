const { auditLog } = require("../utils/auditLogger");
const { getReservationValidity } = require("../services/allocationClient");
const { verifyPermit } = require("../services/permitVerification");
const { savePermitVerification } = require("../repositories/dynamodb/permitVerificationRepository");

async function verifyIncidentPermit(req, res) {
  const { reservation_id, vehicle_plate, spot_id } = req.body ?? {};

  if (typeof reservation_id !== "string" || !reservation_id.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: "RESERVATION_ID_REQUIRED", message: "A reservation ID is required." }
    });
  }

  if (typeof vehicle_plate !== "string" || !vehicle_plate.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: "VEHICLE_PLATE_REQUIRED", message: "A vehicle plate is required." }
    });
  }

  if (typeof spot_id !== "string" || !spot_id.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: "SPOT_ID_REQUIRED", message: "A parking spot ID is required." }
    });
  }

  if (
    reservation_id.trim().length > 128 ||
    vehicle_plate.trim().length > 20 ||
    spot_id.trim().length > 50 ||
    [reservation_id, vehicle_plate, spot_id].some(value => /[<>]/.test(value))
  ) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_VERIFICATION_INPUT",
        message: "Verification fields contain invalid or oversized input."
      }
    });
  }

  const reservationId = reservation_id.trim();
  const vehiclePlate = vehicle_plate.trim();
  const spotId = spot_id?.trim();

  let allocation;

  try {
    allocation = await getReservationValidity(reservationId);
  } catch (error) {
    auditLog("ALLOCATION_CLIENT_ERROR", { outcome: "failure", reason: "UPSTREAM_SERVICE_ERROR" });
  }

  const result = verifyPermit(allocation, {
    reservationId,
    vehiclePlate,
    spotId
  });

  // Save the permit verification attempt to DynamoDB
  try {
    await savePermitVerification({
      reservationId,
      vehiclePlate,
      spotId,
      result
    });
  } catch (error) {
    auditLog("PERMIT_LOG_FAILED", { outcome: "failure", reason: "DATABASE_WRITE_FAILED" });
  }

  if (result === "unverified") {
    return res.status(503).json({
      success: false,
      error: { code: "PERMIT_UNVERIFIED", message: "Reservation validity could not be confirmed." }
    });
  }

  return res.status(200).json({
    success: true,
    data: { reservation_id: reservationId, result }
  });
}

module.exports = { verifyIncidentPermit };
