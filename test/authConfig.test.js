const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAuthConfig } = require("../src/middleware/authConfig");

process.env.AUTH_MODE = "cognito";
process.env.COGNITO_REGION = "us-east-1";
process.env.COGNITO_ENDPOINT = "https://example.test";
process.env.COGNITO_USER_POOL_ID = "test-pool";
process.env.COGNITO_CLIENT_ID = "test-client";
process.env.COGNITO_ISSUER = "https://example.test/pool";
process.env.COGNITO_JWKS_URL = "https://example.test/jwks";
process.env.COGNITO_USERS_JSON = '{"test-sub":{"user_id":"student1","priority":1}}';

delete process.env.COGNITO_USERS_FILE;

test("accepts complete Cognito configuration", () => {
  assert.doesNotThrow(() => validateAuthConfig());
});

test("rejects legacy authentication mode", () => {
  try {
    process.env.AUTH_MODE = "legacy";

    assert.throws(
      () => validateAuthConfig(),
      /Set AUTH_MODE=cognito/
    );
  } finally {
    process.env.AUTH_MODE = "cognito";
  }
});

test("rejects missing Cognito configuration variables", () => {
  const required = [
    "COGNITO_REGION",
    "COGNITO_ENDPOINT",
    "COGNITO_USER_POOL_ID",
    "COGNITO_CLIENT_ID",
    "COGNITO_ISSUER",
    "COGNITO_JWKS_URL"
  ];

  for (const name of required) {
    const original = process.env[name];

    try {
      delete process.env[name];

      assert.throws(
        () => validateAuthConfig(),
        new RegExp("Missing " + name)
      );
    } finally {
      process.env[name] = original;
    }
  }
});

test("rejects missing identity mapping configuration", () => {
  const original = process.env.COGNITO_USERS_JSON;

  try {
    delete process.env.COGNITO_USERS_JSON;

    assert.throws(
      () => validateAuthConfig(),
      /Missing Cognito identity mapping/
    );
  } finally {
    process.env.COGNITO_USERS_JSON = original;
  }
});
