const { getIncidentById } = require("../repositories/dynamodb/incidentRepository");
const { lookupReservation } = require("../services/reservationLookup");
const { auditLog } = require("../utils/auditLogger");

async function checkIncidentReservation(req, res) {
  try {
    const incident = await getIncidentById(req.params.id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        error: {
          code: "INCIDENT_NOT_FOUND",
          message: "Incident report not found."
        }
      });
    }

    const assessment = await lookupReservation(
      incident.vehicle_plate,
      incident.spot_id
    );

    const unavailable = assessment.result === "unverified";

    auditLog("INCIDENT_RESERVATION_CHECK", {
      userId: req.auth.userId,
      role: req.auth.role,
      incidentId: incident.incident_id,
      statusCode: unavailable ? 503 : 200,
      outcome: unavailable ? "failure" : "success",
      reason: assessment.result
    });

    if (unavailable) {
      return res.status(503).json({
        success: false,
        error: {
          code: "RESERVATION_UNVERIFIED",
          message: "Current reservation validity could not be confirmed."
        }
      });
    }

    return res.json({
      success: true,
      data: {
        incident_id: incident.incident_id,
        result: assessment.result,
        reservation_id: assessment.reservation_id,
        checked_at: new Date().toISOString()
      }
    });
  } catch {
    auditLog("RESERVATION_CHECK_FAILED", {
      statusCode: 500,
      outcome: "failure",
      reason: "INTERNAL_ERROR"
    });

    return res.status(500).json({
      success: false,
      error: {
        code: "RESERVATION_CHECK_FAILED",
        message: "Failed to check the incident reservation."
      }
    });
  }
}

module.exports = { checkIncidentReservation };
