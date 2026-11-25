const requiredFields = [
  ["description", "DESCRIPTION_REQUIRED", "A description is required."],
  ["vehicle_plate", "VEHICLE_PLATE_REQUIRED", "A vehicle plate is required."],
  ["spot_id", "SPOT_ID_REQUIRED", "A parking spot ID is required."],
  ["incident_type", "INCIDENT_TYPE_REQUIRED", "An incident type is required."]
];

function validateIncident(body) {
  for (const [field, code, message] of requiredFields) {
    const value = body?.[field];

    if (typeof value !== "string" || value.trim() === "") {
      return { code, message };
    }
  }

  return null;
}

module.exports = { validateIncident };
