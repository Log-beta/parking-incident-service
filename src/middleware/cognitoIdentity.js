const fs = require("node:fs");

function getActor(claims) {
  const groups = claims["cognito:groups"];

  if (!Array.isArray(groups)) {
    throw new Error("Invalid groups");
  }

  const roles = groups.filter(
    group => ["user", "admin"].includes(group)
  );

  if (roles.length !== 1) {
    throw new Error("Invalid role");
  }

  const raw = process.env.COGNITO_USERS_JSON?.trim() ||
    fs.readFileSync(process.env.COGNITO_USERS_FILE, "utf8");

  const mapping = JSON.parse(raw);

  if (!mapping || typeof mapping !== "object" ||
      Array.isArray(mapping) ||
      !Object.hasOwn(mapping, claims.sub)) {
    throw new Error("Unknown user");
  }

  const account = mapping[claims.sub];

  if (!account ||
      typeof account.user_id !== "string" ||
      !account.user_id.trim() ||
      ![1, 2].includes(account.priority)) {
    throw new Error("Invalid identity mapping");
  }

  return {
    userId: account.user_id,
    role: roles[0],
    priority: account.priority
  };
}

module.exports = { getActor };
