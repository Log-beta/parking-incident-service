#!/usr/bin/env bash
set -euo pipefail

table="${1:?Supply the duplicate-key table name}"
floci=(--profile floci --region us-east-1 --endpoint-url http://localhost:4566 --no-cli-pager)

exists=$(aws dynamodb list-tables "${floci[@]}" \
  --query "contains(TableNames, '$table')" --output json)

if [[ "${exists%$'\r'}" == "false" ]]; then
  aws dynamodb create-table "${floci[@]}" \
    --table-name "$table" \
    --attribute-definitions AttributeName=duplicate_key,AttributeType=S \
    --key-schema AttributeName=duplicate_key,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --output json > /dev/null
fi

aws dynamodb wait table-exists "${floci[@]}" --table-name "$table"

aws dynamodb describe-table "${floci[@]}" --table-name "$table" \
  --query 'Table.{Name:TableName,Status:TableStatus,Key:KeySchema}' \
  --output json
