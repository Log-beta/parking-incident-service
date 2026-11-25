const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const app = require("../index");

test("POST /api/incidents rejects a missing description", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");

  const url = `http://127.0.0.1:${server.address().port}/api/incidents`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: {
      code: "DESCRIPTION_REQUIRED",
      message: "A description is required."
    }
  });
});
