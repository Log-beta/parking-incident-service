const { loadRuntimeConfig } =
  require("./src/config/secretsManager");

const { validateAuthConfig } =
  require("./src/middleware/authConfig");

async function start() {
  await loadRuntimeConfig();

  validateAuthConfig();

  const app = require("./index");
  const port = Number(process.env.PORT || 3003);

  app.listen(port, () => {
    console.log(`Incident Service listening on port ${port}`);
  });
}

start().catch(() => {
  console.error("Service startup failed: configuration unavailable.");
  process.exitCode = 1;
});
