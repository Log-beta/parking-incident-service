const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { getReservationValidity } = require("../src/services/allocationClient");
const valid = require("./fixtures/allocation-valid.json");

test("Allocation client sends the agreed GET path and bearer header to a mock server", async (t) => {
  let received;
  const server = http.createServer((req, res) => {
    received = {
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(valid));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const previousUrl = process.env.ALLOCATION_URL;
  const previousToken = process.env.INTERNAL_TOKEN;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.ALLOCATION_URL;
    else process.env.ALLOCATION_URL = previousUrl;

    if (previousToken === undefined) delete process.env.INTERNAL_TOKEN;
    else process.env.INTERNAL_TOKEN = previousToken;
  });

  process.env.ALLOCATION_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.INTERNAL_TOKEN = "dummy-test-token";

  const result = await getReservationValidity("res_123");

  assert.deepEqual(received, {
    method: "GET",
    path: "/api/allocation/internal/reservations/res_123/validity",
    authorization: "Bearer dummy-test-token"
  });
  assert.deepEqual(result, valid);
});
