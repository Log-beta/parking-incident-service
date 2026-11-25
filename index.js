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

app.post("/api/incidents", async (req, res) => {
  const description = req.body?.description;

  if (typeof description !== "string" || description.trim() === "") {
    return res.status(400).json({ message: "A description is required." });
  }

  try {
    const incident = await saveIncident({
      incident_id: randomUUID(),
      description: description.trim()
    });

    return res.status(201).json(incident);
  } catch (error) {
    console.error("Failed to save incident report:", error);
    return res.status(500).json({ message: "Failed to save incident report." });
  }
});

app.get("/api/incidents/:id", async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);

    if (incident === null) {
      return res.status(404).json({ message: "Incident report not found." });
    }

    return res.json(incident);
  } catch (error) {
    console.error("Failed to retrieve incident report:", error);
    return res.status(500).json({ message: "Failed to retrieve incident report." });
  }
});

app.listen(port, () => {
  console.log(`${instanceId} listening on http://localhost:${port}`);
});