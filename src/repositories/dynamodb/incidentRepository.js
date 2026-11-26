const { PutCommand, GetCommand, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
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
async function listIncidentsByOwner(userId, startKey) {
  const result = await db.send(new QueryCommand({
    TableName: tableName,
    IndexName: "user_id-created_at-index",
    KeyConditionExpression: "user_id = :owner",
    ExpressionAttributeValues: { ":owner": userId },
    ScanIndexForward: false,
    Limit: 25,
    ExclusiveStartKey: startKey
  }));

  return {
    items: result.Items ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey ?? null
  };
}

async function startIncidentReview(incidentId, adminId) {
  const result = await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { incident_id: incidentId },
    ConditionExpression: "#status = :from",
    UpdateExpression: "SET #status = :to, updated_by = :actor, updated_at = :now",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":from": "open",
      ":to": "under_review",
      ":actor": adminId,
      ":now": new Date().toISOString()
    },
    ReturnValues: "ALL_NEW"
  }));

  return result.Attributes;
}

async function resolveIncident(incidentId, adminId, resolutionNotes) {
  const now = new Date().toISOString();

  const result = await db.send(new UpdateCommand({
    TableName: tableName,
    Key: { incident_id: incidentId },
    ConditionExpression: "#status = :from",
    UpdateExpression: "SET #status = :to, resolution_notes = :notes, resolved_by = :actor, resolved_at = :now, updated_by = :actor, updated_at = :now",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":from": "under_review",
      ":to": "resolved",
      ":notes": resolutionNotes.trim(),
      ":actor": adminId,
      ":now": now
    },
    ReturnValues: "ALL_NEW"
  }));

  return result.Attributes;
}

module.exports = { saveIncident, getIncidentById, listIncidentsByOwner, startIncidentReview, resolveIncident };