const http = require("node:http");

const ports = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [3113, 3114, 3115];

if (ports.some(port => ![3113, 3114, 3115].includes(port))) {
  throw new Error("Invalid scaling worker port.");
}

let nextWorker = 0;

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;

  if (req.method !== "GET" ||
      !["/health", "/api/incidents"].includes(path)) {
    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      success: false,
      error: "Only benchmark read endpoints are supported."
    }));
  }

  const start = nextWorker;
  nextWorker = (nextWorker + 1) % ports.length;

  for (let attempt = 0; attempt < ports.length; attempt++) {
    const port = ports[(start + attempt) % ports.length];

    try {
      const headers = {};

      if (req.headers.authorization) {
        headers.Authorization = req.headers.authorization;
      }

      const response = await fetch(
        `http://127.0.0.1:${port}${req.url}`,
        {
          headers,
          signal: AbortSignal.timeout(5000),
          redirect: "error"
        }
      );

      const body = await response.text();

      for (const name of [
        "content-type",
        "x-instance-id",
        "retry-after",
        "www-authenticate"
      ]) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
      }

      res.writeHead(response.status);
      return res.end(body);

    } catch {
      // Try the next worker after a connection failure.
    }
  }

  res.writeHead(503, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    success: false,
    error: "All incident workers are unavailable."
  }));
});

server.listen(8080, "127.0.0.1", () => {
  console.log("Incident scaling proxy running on port 8080");
  console.log("Workers:", ports.join(", "));
});
