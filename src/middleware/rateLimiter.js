const { auditLog } = require("../utils/auditLogger");
function createRateLimiter(maxRequests = 60, windowMs = 60000) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new Error("Rate limit must be a positive integer.");
  }

  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error("Rate limit window must be a positive integer.");
  }

  const clients = new Map();

  function isAllowed(clientId, now = Date.now()) {
    const cutoff = now - windowMs;

    const timestamps = (clients.get(clientId) || [])
      .filter(timestamp => timestamp > cutoff);

    if (timestamps.length >= maxRequests) {
      clients.set(clientId, timestamps);
      return false;
    }

    timestamps.push(now);
    clients.set(clientId, timestamps);

    return true;
  }

  function cleanup(now = Date.now()) {
    const cutoff = now - windowMs;
    let removed = 0;

    for (const [clientId, timestamps] of clients) {
      const active = timestamps.filter(timestamp => timestamp > cutoff);

      if (active.length === 0) {
        clients.delete(clientId);
        removed++;
      } else {
        clients.set(clientId, active);
      }
    }

    return removed;
  }

  return { isAllowed, cleanup };
}

function createRateLimitMiddleware({
  maxRequests = 60,
  windowMs = 60000
} = {}) {
  const limiter = createRateLimiter(maxRequests, windowMs);

  const cleanupTimer = setInterval(() => {
    limiter.cleanup();
  }, windowMs);

  cleanupTimer.unref();

  return (req, res, next) => {
    const clientId = req.ip || req.socket.remoteAddress;

    if (!limiter.isAllowed(clientId)) {
      auditLog("RATE_LIMIT_EXCEEDED", {
        method: req.method,
        statusCode: 429,
        outcome: "denied",
        reason: "REQUEST_LIMIT_EXCEEDED"
      });
      res.set("Retry-After", String(Math.ceil(windowMs / 1000)));

      return res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please try again later."
        }
      });
    }

    next();
  };
}

module.exports = { createRateLimiter, createRateLimitMiddleware };
