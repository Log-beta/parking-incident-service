function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function verifyPermit(allocationResponse, { reservationId, vehiclePlate, spotId }) {
  const reservation = allocationResponse?.data;

  if (
    allocationResponse?.success !== true ||
    !hasText(reservationId) ||
    reservation?.reservation_id !== reservationId ||
    typeof reservation.valid !== "boolean"
  ) {
    return "unverified";
  }

  if (!reservation.valid) {
    return "invalid_reservation";
  }

  if (
    !hasText(vehiclePlate) ||
    !hasText(reservation.vehicle_plate) ||
    !hasText(reservation.spot_id) ||
    (spotId != null && !hasText(spotId))
  ) {
    return "unverified";
  }

  if (vehiclePlate !== reservation.vehicle_plate) {
    return "plate_mismatch";
  }

  if (spotId != null && spotId !== reservation.spot_id) {
    return "spot_mismatch";
  }

  return "verified";
}

module.exports = { verifyPermit };
