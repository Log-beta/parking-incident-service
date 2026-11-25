const { PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
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
async function getIncidentById(incidentId) {
  const result = await db.send(new GetCommand({
    TableName: tableName,
    Key: { incident_id: incidentId },
    ConsistentRead: true
  }));

  return result.Item ?? null;
}
module.exports = { saveIncident, getIncidentById };