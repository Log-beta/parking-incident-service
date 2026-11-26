const test = require("node:test");
const assert = require("node:assert/strict");
const { errorHandler } = require("../src/middleware/errorHandler");

test("unexpected errors return a safe HTTP 500 response", (t) => {
  const logMock = t.mock.method(console, "log", () => {});
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

  assert.equal(logMock.mock.callCount(), 1);

  const record = JSON.parse(
    logMock.mock.calls[0].arguments[0]
  );

  assert.equal(record.event, "UNHANDLED_API_ERROR");
  assert.equal(record.statusCode, 500);
  assert.equal(record.outcome, "failure");
  assert.equal(record.reason, "UNEXPECTED_ERROR");

  assert.ok(
    !JSON.stringify(record).includes(error.message)
  );
});
