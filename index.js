const { listMyReports } = require("./src/controllers/myReportsController");
const { isReportOwner } = require("./src/services/incidentOwnership");
const { requireAuth } = require("./src/middleware/requireAuth");
const { verifyIncidentPermit } = require("./src/controllers/permitController");
const { validateIncident } = require("./src/validation/incidentValidation");
const express = require("express");
const { randomUUID } = require("node:crypto");
const { getIncidentById, saveIncident } = require("./src/repositories/dynamodb/incidentRepository");

const app = express();
const port = Number(process.env.PORT ?? 3003);
const instanceId = process.env.INSTANCE_ID || `incidents-${randomUUID()}`;
const service = "parking-incident-service";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a whole number between 1 and 65535.");
}

app.use((req, res, next) => {
  res.set("X-Instance-Id", instanceId);
  next();
});

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Parking Incident Reports Service is running!" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service, instanceId });
});

app.post("/api/incidents/verify", verifyIncidentPermit);

app.post("/api/incidents", requireAuth, async (req, res) => {
  const error = validateIncident(req.body);
  if (error) {
    return res.status(400).json({ success: false, error });
  }

  const { description, vehicle_plate, spot_id, incident_type } = req.body;

  try {
    const incident = await saveIncident({
      incident_id: randomUUID(),
      user_id: req.auth.userId,
      status: "open",
      created_at: new Date().toISOString(),
      description: description.trim(),
      vehicle_plate: vehicle_plate.trim(),
      spot_id: spot_id.trim(),
      incident_type: incident_type.trim()
    });

    return res.status(201).json({ success: true, data: incident });
  } catch (error) {
    console.error("Failed to save incident report:", error);
    return res.status(500).json({ success: false, error: { code: "INCIDENT_SAVE_FAILED", message: "Failed to save incident report." } });
  }
});

app.get("/api/incidents", requireAuth, listMyReports);

app.get("/api/incidents/:id", requireAuth, async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);

    if (!isReportOwner(incident, req.auth.userId)) {
      return res.status(404).json({ success: false, error: { code: "INCIDENT_NOT_FOUND", message: "Incident report not found." } });
    }

    return res.json({ success: true, data: incident });
  } catch (error) {
    console.error("Failed to retrieve incident report:", error);
    return res.status(500).json({ success: false, error: { code: "INCIDENT_LOOKUP_FAILED", message: "Failed to retrieve incident report." } });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`${instanceId} listening on http://localhost:${port}`);
  });
}

module.exports = app;