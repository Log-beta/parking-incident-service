const { createHash } = require("node:crypto");

function getIncidentDuplicateKey(incident) {
  const fields = [
    incident.user_id,
    incident.vehicle_plate.trim(),
    incident.spot_id.trim(),
    incident.incident_type.trim(),
    incident.description.trim()
  ];

  return createHash("sha256")
    .update(JSON.stringify(fields))
    .digest("hex");
}

module.exports = { getIncidentDuplicateKey };
