#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

table="${INCIDENT_REPORTS_TABLE:-IncidentReports}"
index="user_id-created_at-index"
floci=(--profile floci --region us-east-1 --endpoint-url http://localhost:4566 --no-cli-pager)

status=$(aws dynamodb describe-table "${floci[@]}" \
  --table-name "$table" \
  --query "Table.GlobalSecondaryIndexes[?IndexName=='$index'].IndexStatus | [0]" \
  --output text)

case "${status%$'\r'}" in
  ACTIVE|CREATING|UPDATING)
    echo "$index already exists on $table. Status: $status"
    exit 0
    ;;
  None) ;;
  *)
    echo "Unexpected index status: $status" >&2
    exit 1
    ;;
esac

aws dynamodb update-table "${floci[@]}" \
  --table-name "$table" \
  --attribute-definitions AttributeName=user_id,AttributeType=S AttributeName=created_at,AttributeType=S \
  --global-secondary-index-updates file://create-user-reports-index.json \
  --query "TableDescription.GlobalSecondaryIndexes[?IndexName=='$index'].{Index:IndexName,Status:IndexStatus}" \
  --output json
