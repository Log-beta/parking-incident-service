const allowedFields = [
  "userId",
  "role",
  "incidentId",
  "requestId",
  "method",
  "statusCode",
  "outcome",
  "reason",
  "previousStatus",
  "newStatus"
];

function auditLog(event, details = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    service: "parking-incidents",
    instanceId: process.env.INSTANCE_ID || "incidents",
    event
  };

  for (const field of allowedFields) {
    const value = details[field];

    if (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
      record[field] = value;
    }
  }

  console.log(JSON.stringify(record));

  return record;
}

module.exports = { auditLog };
