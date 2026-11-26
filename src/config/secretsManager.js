const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require("@aws-sdk/client-secrets-manager");

async function loadRuntimeConfig() {
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.SECRETS_MANAGER_ENDPOINT ||
      "http://localhost:4566"
  });

  try {
    const result = await client.send(
      new GetSecretValueCommand({
        SecretId: process.env.RUNTIME_SECRET_ID ||
          "parking/incidents/runtime"
      })
    );

    const config = JSON.parse(result.SecretString);

    const allowed = [
      "RATE_LIMIT_MAX",
      "RATE_LIMIT_WINDOW_MS",
      "ALLOCATION_URL",
      "INTERNAL_TOKEN",
      "COGNITO_USERS_JSON", "TURNSTILE_SECRET_KEY", "TURNSTILE_EXPECTED_HOSTNAME", "TURNSTILE_EXPECTED_ACTION"
    ];

    for (const key of allowed) {
      if (typeof config[key] === "string") {
        process.env[key] = config[key];
      }
    }

    console.log(JSON.stringify({
      service: "parking-incidents",
      event: "RUNTIME_CONFIG_LOADED",
      outcome: "success"
    }));
  } finally {
    client.destroy();
  }
}

module.exports = { loadRuntimeConfig };
