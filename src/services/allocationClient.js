async function getReservationValidity(reservationId) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) {
    throw new Error("INTERNAL_TOKEN is required to call Allocation.");
  }

  const baseUrl = process.env.ALLOCATION_URL || "http://localhost:3001";
  const path = `/api/allocation/internal/reservations/${encodeURIComponent(reservationId)}/validity`;

  try {
    const response = await fetch(new URL(path, baseUrl), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
      redirect: "error"
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

module.exports = { getReservationValidity };
