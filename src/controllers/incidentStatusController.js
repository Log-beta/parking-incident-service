const {
  startIncidentReview,
  getIncidentById
} = require("../repositories/dynamodb/incidentRepository");

async function updateIncidentStatus(req, res) {
  if (req.body?.status !== "under_review") {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_STATUS", message: "Expected status under_review." }
    });
  }

  const incidentId = req.params.id;

  try {
    const incident = await startIncidentReview(incidentId, req.auth.userId);
    return res.json({ success: true, data: incident });
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      try {
        const existing = await getIncidentById(incidentId);
        if (!existing) {
          return res.status(404).json({
            success: false,
            error: { code: "INCIDENT_NOT_FOUND", message: "Incident report not found." }
          });
        }

        return res.status(409).json({
          success: false,
          error: { code: "STATUS_CONFLICT", message: "Only an open incident can move under review." }
        });
      } catch (lookupError) {
        console.error("Failed to check incident after status conflict:", lookupError.message);
      }
    } else {
      console.error("Failed to update incident status:", error.message);
    }

    return res.status(500).json({
      success: false,
      error: { code: "STATUS_UPDATE_FAILED", message: "Failed to update incident status." }
    });
  }
}

module.exports = { updateIncidentStatus };
