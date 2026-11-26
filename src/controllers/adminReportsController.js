const { auditLog } = require("../utils/auditLogger");
const { listAdminReports } = require("../repositories/dynamodb/incidentRepository");

const allowedStatuses = new Set(["open", "under_review", "resolved"]);

function readAdminCursor(cursor, filters) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }

  try {
    const page = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      page?.status !== filters.status ||
      (page.vehicle_plate ?? null) !== filters.vehicle_plate ||
      (page.spot_id ?? null) !== filters.spot_id ||
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

function isInvalidTextFilter(value) {
  return value !== undefined && (typeof value !== "string" || !value.trim());
}

async function getAdminReports(req, res) {
  const { status, cursor, vehicle_plate, spot_id } = req.query;

  if (status !== undefined && !allowedStatuses.has(status)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_STATUS", message: "Use open, under_review, or resolved." }
    });
  }

  if (isInvalidTextFilter(vehicle_plate)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_VEHICLE_PLATE", message: "Supply a nonblank vehicle plate or omit it." }
    });
  }

  if (isInvalidTextFilter(spot_id)) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_SPOT_ID", message: "Supply a nonblank spot ID or omit it." }
    });
  }

  const vehiclePlate = vehicle_plate?.trim();
  const spotId = spot_id?.trim();
  const filters = {
    status: status ?? null,
    vehicle_plate: vehiclePlate ?? null,
    spot_id: spotId ?? null
  };

  let startKey;
  if (cursor !== undefined) {
    startKey = readAdminCursor(cursor, filters);
    if (!startKey) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_CURSOR", message: "Invalid cursor for the selected filters." }
      });
    }
  }

  try {
    const { items, lastEvaluatedKey } = await listAdminReports(status, startKey, vehiclePlate, spotId);
    let nextCursor = null;
    if (lastEvaluatedKey) {
      const page = { incident_id: lastEvaluatedKey.incident_id, ...filters };
      nextCursor = Buffer.from(JSON.stringify(page)).toString("base64url");
    }

    return res.json({ success: true, data: { items, next_cursor: nextCursor } });
  } catch (error) {
    auditLog("ADMIN_REPORTS_FAILED", { statusCode: 500, outcome: "failure", reason: "DATABASE_READ_FAILED" });
    return res.status(500).json({
      success: false,
      error: { code: "ADMIN_LIST_FAILED", message: "Failed to list incident reports." }
    });
  }
}

module.exports = { getAdminReports };
