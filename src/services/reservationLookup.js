function unverified() {
  return { result: "unverified", reservation_id: null };
}

async function lookupReservation(vehiclePlate, spotId) {
  if (
    typeof vehiclePlate !== "string" ||
    !vehiclePlate.trim() ||
    typeof spotId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(spotId.trim())
  ) {
    return unverified();
  }

  const plate = vehiclePlate.trim().replace(
    /[a-z]/g, letter => letter.toUpperCase()
  );

  const spot = spotId.trim();
  const token = process.env.INTERNAL_TOKEN;

  if (!token) {
    return unverified();
  }

  try {
    const baseUrl =
      process.env.ALLOCATION_URL || "http://localhost:3001";

    const url = new URL(
      "/api/allocation/internal/reservations/lookup",
      baseUrl
    );

    url.searchParams.set("vehicle_plate", plate);
    url.searchParams.set("spot_id", spot);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      },
      signal: AbortSignal.timeout(3000),
      redirect: "error"
    });

    if (!response.ok) {
      return unverified();
    }

    const body = await response.json();
    const data = body?.data;

    if (body?.success !== true ||
        typeof data?.valid !== "boolean") {
      return unverified();
    }

    if (data.valid === false) {
      if (
        data.reservation_id !== null ||
        data.spot_id !== null ||
        data.vehicle_plate !== null
      ) {
        return unverified();
      }

      return {
        result: "no_active_reservation",
        reservation_id: null
      };
    }

    if (
      typeof data.reservation_id !== "string" ||
      !data.reservation_id.trim() ||
      data.vehicle_plate !== plate ||
      data.spot_id !== spot
    ) {
      return unverified();
    }

    return {
      result: "active_reservation_found",
      reservation_id: data.reservation_id
    };
  } catch {
    return unverified();
  }
}

module.exports = { lookupReservation };
