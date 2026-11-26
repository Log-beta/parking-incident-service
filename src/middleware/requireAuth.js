const { auditLog } = require("../utils/auditLogger");
const { verifyAccessToken } = require("./cognito");
const { getActor } = require("./cognitoIdentity");

function unauthorized(res) {
  auditLog("AUTH_FAILURE", {
    statusCode: 401,
    outcome: "denied",
    reason: "INVALID_CREDENTIALS"
  });

  return res.set("WWW-Authenticate", "Bearer").status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid access token is required."
    }
  });
}

async function requireAuth(req, res, next) {
  const match = /^Bearer +(\S+)$/i.exec(
    req.get("Authorization") || ""
  );

  if (!match) return unauthorized(res);

  if (!process.env.COGNITO_ISSUER?.trim() ||
      !process.env.COGNITO_CLIENT_ID?.trim() ||
      !process.env.COGNITO_JWKS_URL?.trim() ||
      (!process.env.COGNITO_USERS_JSON?.trim() &&
       !process.env.COGNITO_USERS_FILE?.trim())) {
    auditLog("AUTH_UNAVAILABLE", {
      statusCode: 503,
      outcome: "failure",
      reason: "MISSING_AUTH_CONFIGURATION"
    });

    return res.status(503).json({
      success: false,
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is unavailable."
      }
    });
  }

  try {
    const claims = await verifyAccessToken(match[1]);
    req.auth = getActor(claims);
  } catch {
    return unauthorized(res);
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin") {
    auditLog("ADMIN_ACCESS_DENIED", {
      userId: req.auth?.userId,
      role: req.auth?.role,
      statusCode: 403,
      outcome: "denied",
      reason: "ADMIN_REQUIRED"
    });
    return res.status(403).json({
      success: false,
      error: {
        code: "ADMIN_REQUIRED",
        message: "Administrator access is required."
      }
    });
  }

  return next();
}

module.exports = { requireAuth, requireAdmin };
