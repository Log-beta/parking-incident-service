const test = require("node:test");
const assert = require("node:assert/strict");
const { errorHandler } = require("../src/middleware/errorHandler");

test("unexpected errors return a safe HTTP 500 response", () => {
  const error = new Error("Sensitive internal database details");

  let statusCode;
  let responseBody;

  const res = {
    headersSent: false,
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  errorHandler(error, {}, res, () => {
    assert.fail("Unexpected call to next()");
  });

  assert.equal(statusCode, 500);

  assert.deepEqual(responseBody, {
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected server error occurred."
    }
  });

  assert.ok(
    !JSON.stringify(responseBody).includes(error.message)
  );
});
