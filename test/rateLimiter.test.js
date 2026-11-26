const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../src/middleware/rateLimiter");

test("requests within the limit are allowed", () => {
  const limiter = createRateLimiter(3, 60000);

  assert.equal(limiter.isAllowed("client-1", 1000), true);
  assert.equal(limiter.isAllowed("client-1", 2000), true);
  assert.equal(limiter.isAllowed("client-1", 3000), true);
});

test("requests exceeding the limit are rejected", () => {
  const limiter = createRateLimiter(2, 60000);

  assert.equal(limiter.isAllowed("client-1", 1000), true);
  assert.equal(limiter.isAllowed("client-1", 2000), true);
  assert.equal(limiter.isAllowed("client-1", 3000), false);
});

test("different clients have independent limits", () => {
  const limiter = createRateLimiter(1, 60000);

  assert.equal(limiter.isAllowed("client-1", 1000), true);
  assert.equal(limiter.isAllowed("client-1", 2000), false);
  assert.equal(limiter.isAllowed("client-2", 2000), true);
});

test("requests are allowed again when the sliding window expires", () => {
  const limiter = createRateLimiter(1, 60000);

  assert.equal(limiter.isAllowed("client-1", 1000), true);
  assert.equal(limiter.isAllowed("client-1", 60999), false);
  assert.equal(limiter.isAllowed("client-1", 61000), true);
});

test("cleanup removes expired clients while preserving active clients", () => {
  const limiter = createRateLimiter(2, 60000);

  limiter.isAllowed("inactive-client", 1000);
  limiter.isAllowed("active-client", 50000);

  assert.equal(limiter.cleanup(61000), 1);
  assert.equal(limiter.cleanup(61000), 0);

  assert.equal(limiter.isAllowed("active-client", 61000), true);
  assert.equal(limiter.isAllowed("active-client", 62000), false);

  assert.equal(limiter.isAllowed("inactive-client", 62000), true);
});

test("rate limiting middleware returns HTTP 429 when the limit is exceeded", async (t) => {
  const logMock = t.mock.method(console, "log", () => {});
  const express = require("express");
  const { once } = require("node:events");
  const { createRateLimitMiddleware } = require("../src/middleware/rateLimiter");

  const app = express();

  app.use(createRateLimitMiddleware({
    maxRequests: 2,
    windowMs: 60000
  }));

  app.get("/test", (req, res) => {
    res.json({ success: true });
  });

  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));

  await once(server, "listening");

  const url = `http://127.0.0.1:${server.address().port}/test`;

  const first = await fetch(url);
  const second = await fetch(url);
  const third = await fetch(url);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);

  assert.deepEqual(await third.json(), {
    success: false,
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Please try again later."
    }
  });

  assert.ok(Number(third.headers.get("retry-after")) > 0);

  const records = logMock.mock.calls.map(
    call => JSON.parse(call.arguments[0])
  );

  const events = records.filter(
    entry => entry.event === "RATE_LIMIT_EXCEEDED"
  );

  assert.equal(events.length, 1);

  const record = events[0];

  assert.equal(record.method, "GET");
  assert.equal(record.statusCode, 429);
  assert.equal(record.outcome, "denied");
  assert.equal(record.reason, "REQUEST_LIMIT_EXCEEDED");
  assert.equal(Object.hasOwn(record, "ip"), false);
  assert.equal(Object.hasOwn(record, "clientId"), false);
});
