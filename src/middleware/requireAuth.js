const { verifyAccessToken } = require("./cognito");
const { getActor } = require("./cognitoIdentity");

function unauthorized(res) {
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
