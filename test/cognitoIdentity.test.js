const test = require("node:test");
const assert = require("node:assert/strict");
const { getActor } = require("../src/middleware/cognitoIdentity");

process.env.COGNITO_USERS_JSON = JSON.stringify({
  "student-sub": { user_id: "student1", priority: 1 },
  "priority-sub": { user_id: "priority1", priority: 2 },
  "admin-sub": { user_id: "admin1", priority: 1 }
});

test("maps a Cognito student to the correct application identity", () => {
  const actor = getActor({
    sub: "student-sub",
    "cognito:groups": ["user"]
  });

  assert.deepEqual(actor, {
    userId: "student1",
    role: "user",
    priority: 1
  });
});

test("maps a priority user to the correct application identity", () => {
  const actor = getActor({
    sub: "priority-sub",
    "cognito:groups": ["user"]
  });

  assert.deepEqual(actor, {
    userId: "priority1",
    role: "user",
    priority: 2
  });
});

test("maps a Cognito administrator to the correct application identity", () => {
  const actor = getActor({
    sub: "admin-sub",
    "cognito:groups": ["admin"]
  });

  assert.deepEqual(actor, {
    userId: "admin1",
    role: "admin",
    priority: 1
  });
});

test("rejects an unknown Cognito user", () => {
  assert.throws(
    () => getActor({
      sub: "unknown-sub",
      "cognito:groups": ["user"]
    }),
    /Unknown user/
  );
});

test("rejects a Cognito user without groups", () => {
  assert.throws(
    () => getActor({
      sub: "student-sub"
    }),
    /Invalid groups/
  );
});

test("rejects unsupported Cognito roles", () => {
  assert.throws(
    () => getActor({
      sub: "student-sub",
      "cognito:groups": ["guest"]
    }),
    /Invalid role/
  );
});

test("rejects conflicting user and administrator roles", () => {
  assert.throws(
    () => getActor({
      sub: "student-sub",
      "cognito:groups": ["user", "admin"]
    }),
    /Invalid role/
  );
});

test("rejects an identity mapping with an empty user ID", () => {
  const original = process.env.COGNITO_USERS_JSON;

  try {
    process.env.COGNITO_USERS_JSON = JSON.stringify({
      "student-sub": { user_id: "", priority: 1 }
    });

    assert.throws(
      () => getActor({
        sub: "student-sub",
        "cognito:groups": ["user"]
      }),
      /Invalid identity mapping/
    );
  } finally {
    process.env.COGNITO_USERS_JSON = original;
  }
});

test("rejects an identity mapping with an invalid priority", () => {
  const original = process.env.COGNITO_USERS_JSON;

  try {
    process.env.COGNITO_USERS_JSON = JSON.stringify({
      "student-sub": { user_id: "student1", priority: 99 }
    });

    assert.throws(
      () => getActor({
        sub: "student-sub",
        "cognito:groups": ["user"]
      }),
      /Invalid identity mapping/
    );
  } finally {
    process.env.COGNITO_USERS_JSON = original;
  }
});

test("rejects malformed identity mapping JSON", () => {
  const original = process.env.COGNITO_USERS_JSON;

  try {
    process.env.COGNITO_USERS_JSON = "{invalid-json";

    assert.throws(
      () => getActor({
        sub: "student-sub",
        "cognito:groups": ["user"]
      }),
      SyntaxError
    );
  } finally {
    process.env.COGNITO_USERS_JSON = original;
  }
});

test("loads Cognito identity mapping from a JSON file", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cognito-identity-")
  );

  const file = path.join(directory, "users.json");
  const originalJson = process.env.COGNITO_USERS_JSON;
  const originalFile = process.env.COGNITO_USERS_FILE;

  try {
    fs.writeFileSync(file, JSON.stringify({
      "file-test-sub": {
        user_id: "student2",
        priority: 1
      }
    }));

    delete process.env.COGNITO_USERS_JSON;
    process.env.COGNITO_USERS_FILE = file;

    const actor = getActor({
      sub: "file-test-sub",
      "cognito:groups": ["user"]
    });

    assert.deepEqual(actor, {
      userId: "student2",
      role: "user",
      priority: 1
    });
  } finally {
    process.env.COGNITO_USERS_JSON = originalJson;

    if (originalFile === undefined) {
      delete process.env.COGNITO_USERS_FILE;
    } else {
      process.env.COGNITO_USERS_FILE = originalFile;
    }

    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ignores administrator roles supplied through legacy token claims", () => {
  const actor = getActor({
    sub: "student-sub",
    role: "admin",
    "cognito:groups": ["user"]
  });

  assert.equal(actor.userId, "student1");
  assert.equal(actor.role, "user");
});

test("ignores administrator roles supplied through identity mapping", () => {
  const original = process.env.COGNITO_USERS_JSON;

  try {
    process.env.COGNITO_USERS_JSON = JSON.stringify({
      "student-sub": {
        user_id: "student1",
        priority: 1,
        role: "admin"
      }
    });

    const actor = getActor({
      sub: "student-sub",
      "cognito:groups": ["user"]
    });

    assert.equal(actor.role, "user");
  } finally {
    process.env.COGNITO_USERS_JSON = original;
  }
});
