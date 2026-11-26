function validateAuthConfig() {
  if (process.env.AUTH_MODE !== "cognito") {
    throw new Error("Set AUTH_MODE=cognito");
  }

  const required = [
    "COGNITO_REGION",
    "COGNITO_ENDPOINT",
    "COGNITO_USER_POOL_ID",
    "COGNITO_CLIENT_ID",
    "COGNITO_ISSUER",
    "COGNITO_JWKS_URL"
  ];

  for (const name of required) {
    if (!process.env[name]?.trim()) {
      throw new Error("Missing " + name);
    }
  }

  if (!process.env.COGNITO_USERS_JSON?.trim() &&
      !process.env.COGNITO_USERS_FILE?.trim()) {
    throw new Error("Missing Cognito identity mapping");
  }
}

module.exports = { validateAuthConfig };
