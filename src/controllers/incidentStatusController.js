const {
  startIncidentReview,
  resolveIncident,
  getIncidentById
} = require("../repositories/dynamodb/incidentRepository");

async function updateIncidentStatus(req, res) {
  const { status, resolution_notes } = req.body ?? {};
  const incidentId = req.params.id;
  const adminId = req.auth.userId;

  if (status !== "under_review" && status !== "resolved") {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_STATUS", message: "Expected under_review or resolved." }
    });
  }

  if (status === "resolved" &&
      (typeof resolution_notes !== "string" || !resolution_notes.trim())) {
    return res.status(400).json({
      success: false,
      error: {
        code: "RESOLUTION_NOTES_REQUIRED",
        message: "Resolution notes are required to resolve an incident."
      }
    });
  }

  try {
    const incident = status === "resolved"
      ? await resolveIncident(incidentId, adminId, resolution_notes)
      : await startIncidentReview(incidentId, adminId);

    return res.json({ success: true, data: incident });
  } catch (error) {
    if (error.name !== "ConditionalCheckFailedException") {
      console.error("Failed to update incident status:", error.message);
      return res.status(500).json({
        success: false,
        error: { code: "STATUS_UPDATE_FAILED", message: "Failed to update incident status." }
      });
    }
  }

  // The conditional write failed. Check whether the incident exists.
  try {
    const existing = await getIncidentById(incidentId);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: "INCIDENT_NOT_FOUND", message: "Incident report not found." }
      });
    }

    const message = status === "resolved"
      ? "Only an incident under review can be resolved."
      : "Only an open incident can move under review.";

    return res.status(409).json({
      success: false,
      error: { code: "STATUS_CONFLICT", message }
    });
  } catch (error) {
    console.error("Failed to look up incident after status conflict:", error.message);
    return res.status(500).json({
      success: false,
      error: { code: "STATUS_UPDATE_FAILED", message: "Failed to update incident status." }
    });
  }
}

module.exports = { updateIncidentStatus };
