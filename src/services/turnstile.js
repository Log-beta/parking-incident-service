const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function verifyTurnstile(token) {
  if (token == null || (typeof token === "string" && !token.trim())) {
    return "required";
  }

  if (typeof token !== "string" || token.length > 2048) {
    return "invalid";
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret || !secret.trim()) {
    return "unavailable";
  }

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({
        secret,
        response: token
      }),
      signal: AbortSignal.timeout(5000),
      redirect: "error"
    });

    if (!response.ok) {
      return "unavailable";
    }

    const result = await response.json();

    if (result?.success === true) {
      const hostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
      const action = process.env.TURNSTILE_EXPECTED_ACTION;

      if (hostname && result.hostname !== hostname) {
        return "invalid";
      }

      if (action && result.action !== action) {
        return "invalid";
      }

      return "verified";
    }

    if (result?.success !== false) {
      return "unavailable";
    }

    const codes = result["error-codes"];

    if (!Array.isArray(codes)) {
      return "unavailable";
    }

    const tokenErrors = [
      "missing-input-response",
      "invalid-input-response",
      "timeout-or-duplicate"
    ];

    return codes.length > 0 &&
      codes.every(code => tokenErrors.includes(code))
        ? "invalid"
        : "unavailable";
  } catch {
    return "unavailable";
  }
}

module.exports = { verifyTurnstile };
