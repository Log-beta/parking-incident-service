const { getReservationValidity } = require("../services/allocationClient");
const { verifyPermit } = require("../services/permitVerification");

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

  if (spot_id !== undefined && (typeof spot_id !== "string" || !spot_id.trim())) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_SPOT_ID", message: "Supply a nonblank spot ID or omit it." }
    });
  }

  const reservationId = reservation_id.trim();
  let allocation;
  try {
    allocation = await getReservationValidity(reservationId);
  } catch (error) {
    console.error("Allocation client error:", error.message);
  }

  const result = verifyPermit(allocation, {
    reservationId,
    vehiclePlate: vehicle_plate.trim(),
    spotId: spot_id?.trim()
  });

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
