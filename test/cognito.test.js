const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { generateKeyPairSync } = require("node:crypto");
const { verifyAccessToken } = require("../src/middleware/cognito");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048
});

process.env.COGNITO_ISSUER = "https://example.test/cognito";
process.env.COGNITO_CLIENT_ID = "incidents-test-client";
process.env.COGNITO_JWKS_URL = "https://example.test/jwks";

const kid = "incidents-test-key";

const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid,
  alg: "RS256",
  use: "sig"
};

function createToken(overrides = {}) {
  return jwt.sign({
    sub: "test-cognito-user",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["user"],
    ...overrides
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: 300
  });
}

test("accepts a valid Cognito access token", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] })
  }));

  const claims = await verifyAccessToken(createToken());

  assert.equal(claims.sub, "test-cognito-user");
  assert.equal(claims.token_use, "access");
  assert.equal(claims.client_id, "incidents-test-client");
  assert.deepEqual(claims["cognito:groups"], ["user"]);
});

test("rejects a token signed with an untrusted RSA key", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] })
  }));

  const attackerKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  const token = jwt.sign({
    sub: "fake-admin",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["admin"]
  }, attackerKeys.privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: 300
  });

  await assert.rejects(
    () => verifyAccessToken(token),
    /invalid signature/
  );
});

test("rejects an expired Cognito access token", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] })
  }));

  const token = jwt.sign({
    sub: "test-cognito-user",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["user"]
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: -60
  });

  await assert.rejects(
    () => verifyAccessToken(token),
    /jwt expired/
  );
});

test("rejects a Cognito token with an incorrect issuer", async () => {
  const token = createToken({
    iss: "https://example.test/untrusted-pool"
  });

  await assert.rejects(
    () => verifyAccessToken(token),
    /jwt issuer invalid/
  );
});

test("rejects a Cognito token with an incorrect client ID", async () => {
  const token = createToken({
    client_id: "untrusted-client"
  });

  await assert.rejects(
    () => verifyAccessToken(token),
    /Invalid token claims/
  );
});

test("rejects Cognito ID tokens", async () => {
  const token = createToken({
    token_use: "id"
  });

  await assert.rejects(
    () => verifyAccessToken(token),
    /Invalid token claims/
  );
});

test("rejects legacy HS256 access tokens", async () => {
  const token = jwt.sign({
    sub: "test-cognito-user",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["admin"]
  }, "test-only-legacy-secret", {
    algorithm: "HS256",
    keyid: kid,
    expiresIn: 300
  });

  await assert.rejects(
    () => verifyAccessToken(token),
    /Invalid token/
  );
});

test("reuses cached Cognito signing keys", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected JWKS network request");
  });

  const first = await verifyAccessToken(createToken());
  const second = await verifyAccessToken(createToken());

  assert.equal(first.sub, "test-cognito-user");
  assert.equal(second.sub, "test-cognito-user");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects authentication when Cognito configuration is missing", async () => {
  const token = createToken();
  const originalIssuer = process.env.COGNITO_ISSUER;

  try {
    delete process.env.COGNITO_ISSUER;

    await assert.rejects(
      () => verifyAccessToken(token),
      /Missing Cognito configuration/
    );
  } finally {
    process.env.COGNITO_ISSUER = originalIssuer;
  }
});

test("refreshes Cognito signing keys after cache expiration", async (t) => {
  const originalNow = Date.now();

  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] })
  }));

  t.mock.method(Date, "now", () => originalNow + 301000);

  const token = createToken();
  const claims = await verifyAccessToken(token);

  assert.equal(claims.sub, "test-cognito-user");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("refreshes signing keys when Cognito rotates its signing key", async (t) => {
  const rotatedKeys = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });

  const rotatedKid = "rotated-cognito-key";

  const rotatedJwk = {
    ...rotatedKeys.publicKey.export({ format: "jwk" }),
    kid: rotatedKid,
    alg: "RS256",
    use: "sig"
  };

  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ keys: [jwk, rotatedJwk] })
  }));

  const token = jwt.sign({
    sub: "test-cognito-user",
    iss: process.env.COGNITO_ISSUER,
    client_id: process.env.COGNITO_CLIENT_ID,
    token_use: "access"
  }, rotatedKeys.privateKey, {
    algorithm: "RS256",
    keyid: rotatedKid,
    expiresIn: 300
  });

  const claims = await verifyAccessToken(token);

  assert.equal(claims.sub, "test-cognito-user");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("limits JWKS refreshes for repeated unknown signing keys", async (t) => {
  const now = Date.now() + 60000;

  t.mock.method(Date, "now", () => now);

  const fetchMock = t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ keys: [jwk] })
  }));

  for (let i = 0; i < 5; i++) {
    const token = jwt.sign({
      sub: "test-cognito-user",
      iss: process.env.COGNITO_ISSUER,
      client_id: process.env.COGNITO_CLIENT_ID,
      token_use: "access"
    }, privateKey, {
      algorithm: "RS256",
      keyid: `unknown-key-${i}`,
      expiresIn: 300
    });

    await assert.rejects(
      () => verifyAccessToken(token),
      /Signing key not found/
    );
  }

  assert.equal(fetchMock.mock.callCount(), 1);
});

test("concurrent token verification shares one JWKS refresh", async (t) => {
  const now = Date.now() + 600000;

  t.mock.method(Date, "now", () => now);

  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    await new Promise(resolve => setTimeout(resolve, 25));

    return {
      ok: true,
      json: async () => ({ keys: [jwk] })
    };
  });

  const token = createToken();

  const results = await Promise.all(
    Array.from({ length: 10 }, () => verifyAccessToken(token))
  );

  assert.equal(results.length, 10);

  for (const claims of results) {
    assert.equal(claims.sub, "test-cognito-user");
  }

  assert.equal(fetchMock.mock.callCount(), 1);
});
