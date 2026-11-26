const { listAdminReports } = require("../repositories/dynamodb/incidentRepository");

const allowedStatuses = new Set(["open", "under_review", "resolved"]);

function readAdminCursor(cursor, status, vehiclePlate) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }

  try {
    const page = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));

    // Earlier status-only cursors omitted vehicle_plate.
    if (
      page?.status !== (status ?? null) ||
      (page.vehicle_plate ?? null) !== (vehiclePlate ?? null) ||
      typeof page.incident_id !== "string" ||
      !page.incident_id.trim()
    ) {
      return null;
    }

    return { incident_id: page.incident_id };
  } catch {
    return null;
  }
}

async function getAdminReports(req, res) {
  const { status, cursor, vehicle_plate } = req.query;

  if (status !== undefined && !allowedStatuses.has(status)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_STATUS", message: "Use open, under_review, or resolved." }
    });
  }

  if (vehicle_plate !== undefined &&
      (typeof vehicle_plate !== "string" || !vehicle_plate.trim())) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_VEHICLE_PLATE", message: "Supply a nonblank vehicle plate or omit it." }
    });
  }

  const vehiclePlate = vehicle_plate?.trim();
  let startKey;
  if (cursor !== undefined) {
    startKey = readAdminCursor(cursor, status, vehiclePlate);
    if (!startKey) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_CURSOR", message: "Invalid cursor for the selected filters." }
      });
    }
  }

  try {
    const { items, lastEvaluatedKey } = await listAdminReports(status, startKey, vehiclePlate);
    let nextCursor = null;

    if (lastEvaluatedKey) {
      const page = {
        incident_id: lastEvaluatedKey.incident_id,
        status: status ?? null,
        vehicle_plate: vehiclePlate ?? null
      };
      nextCursor = Buffer.from(JSON.stringify(page)).toString("base64url");
    }

    return res.json({ success: true, data: { items, next_cursor: nextCursor } });
  } catch (error) {
    console.error("Failed to list admin reports:", error.message);
    return res.status(500).json({
      success: false,
      error: { code: "ADMIN_LIST_FAILED", message: "Failed to list incident reports." }
    });
  }
}

module.exports = { getAdminReports };
