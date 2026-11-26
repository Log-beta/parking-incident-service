const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");

const { after } = require("node:test");

const jwt = require("jsonwebtoken");

const { generateKeyPairSync } = require("node:crypto");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048
});

process.env.COGNITO_ISSUER = "https://example.test/cognito";
process.env.COGNITO_CLIENT_ID = "test-parking";
process.env.COGNITO_JWKS_URL = "https://example.test/jwks";

const kid = "incidents-integration-test-key";

const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid,
  alg: "RS256",
  use: "sig"
};

process.env.COGNITO_USERS_JSON = JSON.stringify({
  "user-1": { user_id: "user-1", priority: 1 },
  "user-2": { user_id: "user-2", priority: 1 },
  "admin-1": { user_id: "admin-1", priority: 1 },
  "admin-2": { user_id: "admin-2", priority: 1 }
});

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, options) => {
  if (input === process.env.COGNITO_JWKS_URL) {
    return new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  return originalFetch(input, options);
};

after(() => {
  globalThis.fetch = originalFetch;
});

function createCognitoToken({ sub, role }) {
  return jwt.sign({
    sub,
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": [role]
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: "5m"
  });
}

const app = require("../index");
const db = require("../src/config/dynamodb");
const valid = require("./fixtures/allocation-valid.json");

const presented = {
  reservation_id: "res_123",
  vehicle_plate: "ABC123",
  spot_id: "A1"
};

const invalid = {
  success: true,
  data: {
    reservation_id: "res_123",
    valid: false,
    spot_id: null,
    vehicle_plate: null
  }
};

async function setup(t, allocationResponse, databaseFailure = false) {
  const allocationServer = http.createServer((req, res) => {
    if (allocationResponse === null) {
      res.writeHead(503);
      return res.end();
    }

    res.writeHead(200, {
      "Content-Type": "application/json"
    });

    res.end(JSON.stringify(allocationResponse));
  });

  allocationServer.listen(0, "127.0.0.1");
  await once(allocationServer, "listening");

  t.after(() =>
    new Promise((resolve) => allocationServer.close(resolve))
  );

  const previousUrl = process.env.ALLOCATION_URL;
  const previousToken = process.env.INTERNAL_TOKEN;

  process.env.ALLOCATION_URL =
    `http://127.0.0.1:${allocationServer.address().port}`;

  process.env.INTERNAL_TOKEN = "dummy-test-token";

  t.after(() => {
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
  });

  const mockSend = t.mock.method(db, "send", async () => {
    if (databaseFailure) {
      throw new Error("Simulated database failure");
    }

    return {};
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  t.after(() =>
    new Promise((resolve) => server.close(resolve))
  );

  const url =
    `http://127.0.0.1:${server.address().port}/api/incidents/verify`;

  async function verify(body) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${createCognitoToken({ sub: "user-1", role: "user" })}`
      },
      body: JSON.stringify(body)
    });
  }

  return { verify, mockSend };
}

const cases = [
  ["valid permit", valid, presented, "verified", 200],
  [
    "invalid reservation",
    invalid,
    presented,
    "invalid_reservation",
    200
  ],
  [
    "plate mismatch",
    valid,
    { ...presented, vehicle_plate: "XYZ789" },
    "plate_mismatch",
    200
  ],
  [
    "spot mismatch",
    valid,
    { ...presented, spot_id: "A2" },
    "spot_mismatch",
    200
  ],
  [
    "Allocation unavailable",
    null,
    presented,
    "unverified",
    503
  ]
];

for (const [scenario, allocation, input, expected, status] of cases) {
  test(`controller logs ${scenario}`, async (t) => {
    const { verify, mockSend } = await setup(t, allocation);

    const response = await verify(input);
    const body = await response.json();

    assert.equal(response.status, status);
    assert.equal(mockSend.mock.callCount(), 1);

    const item =
      mockSend.mock.calls[0].arguments[0].input.Item;

    assert.equal(item.reservation_id, input.reservation_id);
    assert.equal(item.vehicle_plate, input.vehicle_plate);
    assert.equal(item.spot_id, input.spot_id);
    assert.equal(item.result, expected);
    assert.ok(item.verification_id);
    assert.ok(!Number.isNaN(Date.parse(item.created_at)));

    if (expected === "unverified") {
      assert.equal(body.success, false);
      assert.equal(body.error.code, "PERMIT_UNVERIFIED");
    } else {
      assert.equal(body.success, true);
      assert.equal(body.data.reservation_id, input.reservation_id);
      assert.equal(body.data.result, expected);
    }
  });
}

test("controller rejects verification without a parking spot", async (t) => {
  const { verify, mockSend } = await setup(t, valid);

  const response = await verify({
    reservation_id: "res_123",
    vehicle_plate: "ABC123"
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "SPOT_ID_REQUIRED");
  assert.equal(mockSend.mock.callCount(), 0);
});

test("controller preserves verification response when logging fails", async (t) => {
  const { verify, mockSend } = await setup(t, valid, true);

  const response = await verify(presented);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.result, "verified");
  assert.equal(mockSend.mock.callCount(), 1);
});

test("controller does not log malformed requests", async (t) => {
  const { verify, mockSend } = await setup(t, valid);

  const response = await verify({});

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "RESERVATION_ID_REQUIRED");
  assert.equal(mockSend.mock.callCount(), 0);
});


test("controller rejects oversized and unsafe verification input", async (t) => {
  const { verify, mockSend } = await setup(t, valid);

  for (const input of [
    { ...presented, reservation_id: "x".repeat(129) },
    { ...presented, vehicle_plate: "x".repeat(21) },
    { ...presented, spot_id: "x".repeat(51) },
    { ...presented, vehicle_plate: "<script>" }
  ]) {
    const response = await verify(input);

    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error.code,
      "INVALID_VERIFICATION_INPUT"
    );
  }

  assert.equal(mockSend.mock.callCount(), 0);
});
