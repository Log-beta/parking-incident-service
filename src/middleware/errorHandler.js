const { auditLog } = require("../utils/auditLogger");
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON."
      }
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the allowed size."
      }
    });
  }

  auditLog("UNHANDLED_API_ERROR", {
    method: req.method,
    statusCode: 500,
    outcome: "failure",
    reason: "UNEXPECTED_ERROR"
  });

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected server error occurred."
    }
  });
}

module.exports = { errorHandler };
