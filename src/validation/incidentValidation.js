const requiredFields = [
  ["description", "DESCRIPTION_REQUIRED", "A description is required."],
  ["vehicle_plate", "VEHICLE_PLATE_REQUIRED", "A vehicle plate is required."],
  ["spot_id", "SPOT_ID_REQUIRED", "A parking spot ID is required."],
  ["incident_type", "INCIDENT_TYPE_REQUIRED", "An incident type is required."]
];

const fieldLimits = [
  ["description", 500, "DESCRIPTION_TOO_LONG", "Description"],
  ["vehicle_plate", 20, "VEHICLE_PLATE_TOO_LONG", "Vehicle plate"],
  ["spot_id", 50, "SPOT_ID_TOO_LONG", "Parking spot ID"],
  ["incident_type", 50, "INCIDENT_TYPE_TOO_LONG", "Incident type"]
];

function validateIncident(body) {
  for (const [field, code, message] of requiredFields) {
    const value = body?.[field];

    if (typeof value !== "string" || value.trim() === "") {
      return { code, message };
    }
  }

  for (const [field, max, code, label] of fieldLimits) {
    if (body[field].trim().length > max) {
      return {
        code,
        message: `${label} must not exceed ${max} characters.`
      };
    }
  }

  for (const [field] of requiredFields) {
    if (/[<>]/.test(body[field])) {
      return {
        code: "UNSAFE_INPUT",
        message: "HTML markup and angle brackets are not allowed in incident fields."
      };
    }
  }

  return null;
}

module.exports = { validateIncident };
