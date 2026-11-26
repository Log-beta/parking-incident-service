import http from "k6/http";
import { check } from "k6";

const token = open("../../.local/scaling-access-token.txt").trim();

export const options = {
  vus: 20,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"]
  },
  summaryTrendStats: [
    "avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"
  ]
};

export default function () {
  const response = http.get(
    "http://127.0.0.1:8080/api/incidents",
    {
      headers: {
        Authorization: `Bearer ${token}`
      },
      timeout: "10s"
    }
  );

  check(response, {
    "HTTP status is 200": r => r.status === 200,
    "Report retrieval successful": r => {
      try {
        return r.json("success") === true;
      } catch {
        return false;
      }
    }
  });
}
