// Verify Cognito access tokens independently in each backend.
const jwt = require("jsonwebtoken");
const { createPublicKey } = require("node:crypto");

let cachedKeys = [];
let cacheExpires = 0;
let lastForcedRefresh = 0;
let refreshPromise = null;

async function refreshSigningKeys() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(process.env.COGNITO_JWKS_URL, {
        signal: AbortSignal.timeout(5000),
        redirect: "error"
      });

      if (!response.ok) {
        throw new Error("Unable to retrieve Cognito public keys");
      }

      const data = await response.json();

      if (!Array.isArray(data.keys)) {
        throw new Error("Invalid Cognito JWKS");
      }

      cachedKeys = data.keys;
      cacheExpires = Date.now() + 300000;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function findSigningKey(kid) {
  return cachedKeys.find(
    k => k.kid === kid && k.kty === "RSA" &&
         k.alg === "RS256" && k.use === "sig"
  );
}

async function getSigningKey(kid) {
  const cacheExpired = Date.now() >= cacheExpires;

  if (cacheExpired) {
    await refreshSigningKeys();
  }

  let key = findSigningKey(kid);

  if (!key && !cacheExpired &&
      Date.now() - lastForcedRefresh >= 30000) {
    lastForcedRefresh = Date.now();
    await refreshSigningKeys();
    key = findSigningKey(kid);
  }

  if (!key) {
    throw new Error("Signing key not found");
  }

  return createPublicKey({ key, format: "jwk" });
}


async function verifyAccessToken(token) {
  if (!process.env.COGNITO_ISSUER || !process.env.COGNITO_CLIENT_ID ||
      !process.env.COGNITO_JWKS_URL) {
    throw new Error("Missing Cognito configuration");
  }
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || decoded.header.alg !== "RS256" ||
      typeof decoded.header.kid !== "string") {
    throw new Error("Invalid token");
  }
  const publicKey = await getSigningKey(decoded.header.kid);
  const claims = jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: process.env.COGNITO_ISSUER,
  });
  if (claims.token_use !== "access" ||
      claims.client_id !== process.env.COGNITO_CLIENT_ID ||
      !Number.isInteger(claims.exp) ||
      typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("Invalid token claims");
  }
  return claims;
}

module.exports = { verifyAccessToken };
