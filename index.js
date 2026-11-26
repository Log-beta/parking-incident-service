if (require.main === module) {
  console.error("Use npm start to initialize the service securely.");
  process.exit(1);
}

const { checkIncidentReservation } = require("./src/controllers/reservationCheckController");
const { verifyTurnstile } = require("./src/services/turnstile");
const { auditLog } = require("./src/utils/auditLogger");
const { errorHandler } = require("./src/middleware/errorHandler");
const { getAdminReports } = require("./src/controllers/adminReportsController");
const { updateIncidentStatus } = require("./src/controllers/incidentStatusController");
const { listMyReports } = require("./src/controllers/myReportsController");
const { isReportOwner } = require("./src/services/incidentOwnership");
const { requireAuth, requireAdmin } = require("./src/middleware/requireAuth");
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

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer"
  });

  next();
});

const { createRateLimitMiddleware } = require("./src/middleware/rateLimiter");

const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 60);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);

app.use("/api", createRateLimitMiddleware({
  maxRequests: rateLimitMax,
  windowMs: rateLimitWindowMs
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Parking Incident Reports Service is running!" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service, instanceId });
});

app.post("/api/incidents/verify", requireAuth, verifyIncidentPermit);

app.post("/api/incidents", requireAuth, async (req, res) => {
  const error = validateIncident(req.body);
  if (error) {
    return res.status(400).json({ success: false, error });
  }

  const verification = await verifyTurnstile(req.body.turnstile_token);

  if (verification !== "verified") {
    const unavailable = verification === "unavailable";

    const code = unavailable
      ? "TURNSTILE_UNAVAILABLE"
      : verification === "required"
        ? "TURNSTILE_REQUIRED"
        : "TURNSTILE_INVALID";

    const status = unavailable ? 503 : 400;

    auditLog("TURNSTILE_VERIFICATION_FAILED", {
      userId: req.auth.userId,
      role: req.auth.role,
      statusCode: status,
      outcome: unavailable ? "failure" : "denied",
      reason: code
    });

    return res.status(status).json({
      success: false,
      error: {
        code,
        message: unavailable
          ? "Verification is temporarily unavailable."
          : "Complete a new security challenge and try again."
      }
    });
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

    auditLog("INCIDENT_CREATED", {
      userId: req.auth.userId,
      role: req.auth.role,
      incidentId: incident.incident_id,
      statusCode: 201,
      outcome: "success"
    });

    return res.status(201).json({ success: true, data: incident });
 } catch (error) {
    if (error.code === "DUPLICATE_INCIDENT") {
      auditLog("DUPLICATE_INCIDENT_REJECTED", {
        userId: req.auth.userId,
        role: req.auth.role,
        statusCode: 409,
        outcome: "denied",
        reason: "DUPLICATE_INCIDENT"
      });
      return res.status(409).json({
        success: false,
        error: {
          code: "DUPLICATE_INCIDENT",
          message: "An identical incident was submitted within the last 10 minutes."
        }
      });
    }

    auditLog("INCIDENT_SAVE_FAILED", {
      userId: req.auth.userId,
      statusCode: 500,
      outcome: "failure",
      reason: "DATABASE_WRITE_FAILED"
    });
    return res.status(500).json({
      success: false,
      error: {
        code: "INCIDENT_SAVE_FAILED",
        message: "Failed to save incident report."
      }
    });
}
});

app.get("/api/incidents", requireAuth, listMyReports);

app.get("/api/incidents/admin/reports", requireAuth, requireAdmin, getAdminReports);

app.patch("/api/incidents/:id/status", requireAuth, requireAdmin, updateIncidentStatus);

app.get("/api/incidents/:id/reservation-check", requireAuth, requireAdmin, checkIncidentReservation);

app.get("/api/incidents/:id", requireAuth, async (req, res) => {
  try {
    const incident = await getIncidentById(req.params.id);

    if (!isReportOwner(incident, req.auth.userId)) {
      auditLog("INCIDENT_ACCESS_DENIED", {
        userId: req.auth.userId,
        role: req.auth.role,
        statusCode: 404,
        outcome: "denied",
        reason: "OWNERSHIP_MISMATCH"
      });
      return res.status(404).json({ success: false, error: { code: "INCIDENT_NOT_FOUND", message: "Incident report not found." } });
    }

    return res.json({ success: true, data: incident });
  } catch (error) {
    auditLog("INCIDENT_RETRIEVAL_FAILED", {
      userId: req.auth.userId,
      statusCode: 500,
      outcome: "failure",
      reason: "DATABASE_READ_FAILED"
    });
    return res.status(500).json({ success: false, error: { code: "INCIDENT_LOOKUP_FAILED", message: "Failed to retrieve incident report." } });
  }
});

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: {
      code: "ENDPOINT_NOT_FOUND",
      message: "The requested endpoint does not exist."
    }
  });
});

app.use(errorHandler);

module.exports = app;
