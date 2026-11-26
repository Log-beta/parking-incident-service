const http = require("node:http");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { generateKeyPairSync } = require("node:crypto");
const jwt = require("jsonwebtoken");

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048
});

const kid = "local-scaling-test-key";
const children = [];

const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid,
  alg: "RS256",
  use: "sig"
};

const jwks = http.createServer((req, res) => {
  if (req.url !== "/jwks") {
    res.writeHead(404);
    return res.end();
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ keys: [jwk] }));
});

jwks.listen(0, "127.0.0.1", () => {
  const endpoint = `http://127.0.0.1:${jwks.address().port}`;
  const issuer = `${endpoint}/us-east-1_scalingtest`;

  const env = {
    ...process.env,
    AWS_PROFILE: "floci",
    AWS_REGION: "us-east-1",
    AUTH_MODE: "cognito",
    COGNITO_REGION: "us-east-1",
    COGNITO_ENDPOINT: endpoint,
    COGNITO_USER_POOL_ID: "us-east-1_scalingtest",
    COGNITO_CLIENT_ID: "scaling-test-client",
    COGNITO_ISSUER: issuer,
    COGNITO_JWKS_URL: `${endpoint}/jwks`,
    COGNITO_USERS_JSON: JSON.stringify({
      "scaling-user": {
        user_id: "scaling-user",
        priority: 1
      }
    }),
    DYNAMODB_ENDPOINT: "http://localhost:4566",
    SECRETS_MANAGER_ENDPOINT: "http://localhost:4566",
    RUNTIME_SECRET_ID: "parking/incidents/turnstile-test",
    INCIDENT_REPORTS_TABLE: "IncidentReportsTest",
    INCIDENT_DUPLICATE_KEYS_TABLE: "IncidentDuplicateKeysTest",
    PERMIT_VERIFICATION_LOGS_TABLE: "PermitVerificationLogsScalingTest",
    ALLOCATION_URL: "http://127.0.0.1:1",
    RATE_LIMIT_MAX: "100000",
    RATE_LIMIT_WINDOW_MS: "60000"
  };

  delete env.COGNITO_USERS_FILE;
  delete env.INTERNAL_TOKEN;
  delete env.AWS_ACCESS_KEY_ID;
  delete env.AWS_SECRET_ACCESS_KEY;
  delete env.AWS_SESSION_TOKEN;

  const token = jwt.sign({
    sub: "scaling-user",
    iss: issuer,
    client_id: env.COGNITO_CLIENT_ID,
    token_use: "access",
    "cognito:groups": ["user"]
  }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    expiresIn: "1h"
  });

  fs.mkdirSync(".local", { recursive: true });
  fs.writeFileSync(".local/scaling-access-token.txt", token);

  const workerCode = `
    async function main() {
      await require("./src/config/secretsManager").loadRuntimeConfig();
      require("./src/middleware/authConfig").validateAuthConfig();

      const app = require("./index");

      app.listen(Number(process.env.PORT), "127.0.0.1", () => {
        console.log(process.env.INSTANCE_ID + " ready on port " + process.env.PORT);
      });
    }

    main().catch(error => {
      console.error("Worker startup failed:", error.name, error.message);
      process.exitCode = 1;
    });
  `;

  for (const port of [3113, 3114, 3115]) {
    const child = spawn(process.execPath, ["-e", workerCode], {
      env: {
        ...env,
        PORT: String(port),
        INSTANCE_ID: `scaling-worker-${port}`
      },
      stdio: "inherit"
    });

    children.push(child);

    child.on("exit", code => {
      console.log(`Worker ${port} stopped. Exit code: ${code}`);
    });
  }
});

function shutdown() {
  for (const child of children) {
    child.kill();
  }

  fs.rmSync(".local/scaling-access-token.txt", { force: true });
  jwks.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
