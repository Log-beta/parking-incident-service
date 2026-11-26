const jwt = require("jsonwebtoken");

function unauthorized(res) {
  return res.set("WWW-Authenticate", "Bearer").status(401).json({
    success: false,
    error: { code: "UNAUTHORIZED", message: "A valid access token is required." }
  });
}

function requireAuth(req, res, next) {
  const match = /^Bearer +(\S+)$/i.exec(req.get("Authorization") || "");
  if (!match) return unauthorized(res);

  const { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } = process.env;
  if (!JWT_SECRET || !JWT_ISSUER || !JWT_AUDIENCE) {
    return res.status(503).json({
      success: false,
      error: { code: "AUTH_UNAVAILABLE", message: "Authentication is unavailable." }
    });
  }

  let claims;
  try {
    claims = jwt.verify(match[1], JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
  } catch {
    return unauthorized(res);
  }

  if (typeof claims?.sub !== "string" || !claims.sub.trim() ||
      !Number.isFinite(claims.exp)) {
    return unauthorized(res);
  }

  req.auth = { userId: claims.sub, role: claims.role };
  return next();
}

function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: { code: "ADMIN_REQUIRED", message: "Administrator access is required." }
    });
  }

  return next();
}

module.exports = { requireAuth, requireAdmin };
