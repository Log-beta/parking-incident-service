const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");

const {
  lookupReservation
} = require("../src/services/reservationLookup");

const matching = {
  success: true,
  data: {
    valid: true,
    reservation_id: "res_123",
    vehicle_plate: "ABC123",
    spot_id: "A1"
  }
};

const noMatch = {
  success: true,
  data: {
    valid: false,
    reservation_id: null,
    vehicle_plate: null,
    spot_id: null
  }
};

async function setup(t, body, status = 200) {
  const requests = [];

  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization
    });

    if (status === 0) {
      req.socket.destroy();
      return;
    }

    res.writeHead(status, {
      "Content-Type": "application/json"
    });

    res.end(
      typeof body === "string" ? body : JSON.stringify(body)
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const previousUrl = process.env.ALLOCATION_URL;
  const previousToken = process.env.INTERNAL_TOKEN;

  process.env.ALLOCATION_URL =
    `http://127.0.0.1:${server.address().port}`;

  process.env.INTERNAL_TOKEN = "dummy-lookup-test-token";

  t.after(async () => {
    if (previousUrl === undefined) {
      delete process.env.ALLOCATION_URL;
    } else {
      process.env.ALLOCATION_URL = previousUrl;
    }

    if (previousToken === undefined) {
      delete process.env.INTERNAL_TOKEN;
    } else {
      process.env.INTERNAL_TOKEN = previousToken;
    }

    await new Promise(resolve => server.close(resolve));
  });

  return requests;
}

test("Lookup sends correct path, query and internal Bearer token", async t => {
  const requests = await setup(t, matching);

  const result = await lookupReservation(" abc123 ", "A1");

  assert.deepEqual(result, {
    result: "active_reservation_found",
    reservation_id: "res_123"
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");

  const url = new URL(requests[0].url, "http://localhost");

  assert.equal(
    url.pathname,
    "/api/allocation/internal/reservations/lookup"
  );

  assert.equal(url.searchParams.get("vehicle_plate"), "ABC123");
  assert.equal(url.searchParams.get("spot_id"), "A1");
  assert.equal(
    requests[0].authorization,
    "Bearer dummy-lookup-test-token"
  );
});

test("Lookup correctly encodes Arabic plates and internal spaces", async t => {
  const plate = "\u0627 \u0628 123-4";

  const requests = await setup(t, {
    ...matching,
    data: {
      ...matching.data,
      vehicle_plate: plate
    }
  });

  const result = await lookupReservation(plate, "A1");

  assert.equal(result.result, "active_reservation_found");

  const url = new URL(requests[0].url, "http://localhost");

  assert.equal(url.searchParams.get("vehicle_plate"), plate);
});

test("Lookup distinguishes no active reservation from API failure", async t => {
  await setup(t, noMatch);

  assert.deepEqual(
    await lookupReservation("ABC123", "A1"),
    {
      result: "no_active_reservation",
      reservation_id: null
    }
  );
});

const failureCases = [
  [
    "mismatched vehicle plate",
    { ...matching, data: {
      ...matching.data, vehicle_plate: "XYZ789"
    }},
    200
  ],
  [
    "mismatched parking spot",
    { ...matching, data: {
      ...matching.data, spot_id: "A2"
    }},
    200
  ],
  ["malformed response", { success: true, data: {} }, 200],
  ["malformed JSON", "not-json", 200],
  ["invalid request", {}, 400],
  ["invalid internal token", {}, 401],
  ["rate limiting", {}, 429],
  ["database failure", {}, 500],
  ["Allocation unavailable or conflicting reservations", {}, 503],
  ["connection failure", {}, 0]
];

for (const [scenario, body, status] of failureCases) {
  test(`Lookup returns unverified for ${scenario}`, async t => {
    await setup(t, body, status);

    assert.deepEqual(
      await lookupReservation("ABC123", "A1"),
      {
        result: "unverified",
        reservation_id: null
      }
    );
  });
}

test("Lookup does not call Allocation without internal token", async t => {
  const requests = await setup(t, matching);

  delete process.env.INTERNAL_TOKEN;

  const result = await lookupReservation("ABC123", "A1");

  assert.equal(result.result, "unverified");
  assert.equal(requests.length, 0);
});

test("Lookup rejects malformed input before calling Allocation", async t => {
  const requests = await setup(t, matching);

  for (const [plate, spot] of [
    ["", "A1"],
    ["ABC123", ""],
    ["ABC123", "invalid/spot"],
    ["ABC123", "A".repeat(65)]
  ]) {
    const result = await lookupReservation(plate, spot);

    assert.equal(result.result, "unverified");
  }

  assert.equal(requests.length, 0);
});
