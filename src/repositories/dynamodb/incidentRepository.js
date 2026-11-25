const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const db = require("../../config/dynamodb");

const tableName = process.env.INCIDENT_REPORTS_TABLE || "IncidentReports";

async function saveIncident(incident) {
  await db.send(new PutCommand({
    TableName: tableName,
    Item: incident,
    ConditionExpression: "attribute_not_exists(incident_id)"
  }));

  return incident;
}

module.exports = { saveIncident };