const { auditLog } = require("../utils/auditLogger");
const { listIncidentsByOwner } = require("../repositories/dynamodb/incidentRepository");

function readCursor(cursor, userId) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    return null;
  }

  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      key?.user_id !== userId ||
      typeof key.incident_id !== "string" || !key.incident_id.trim() ||
      typeof key.created_at !== "string" || !key.created_at.trim()
    ) {
      return null;
    }

    return { user_id: userId, incident_id: key.incident_id, created_at: key.created_at };
  } catch {
    return null;
  }
}

async function listMyReports(req, res) {
  const userId = req.auth.userId;
  let startKey;

  if (req.query.cursor !== undefined) {
    startKey = readCursor(req.query.cursor, userId);
    if (!startKey) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_CURSOR", message: "Invalid report cursor." }
      });
    }
  }

  try {
    const { items, lastEvaluatedKey } = await listIncidentsByOwner(userId, startKey);
    const nextCursor = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString("base64url")
      : null;

    return res.json({ success: true, data: { items, next_cursor: nextCursor } });
  } catch (error) {
    auditLog("MY_REPORTS_FAILED", { statusCode: 500, outcome: "failure", reason: "DATABASE_READ_FAILED" });
    return res.status(500).json({
      success: false,
      error: { code: "INCIDENT_LIST_FAILED", message: "Failed to list incident reports." }
    });
  }
}

module.exports = { listMyReports };
