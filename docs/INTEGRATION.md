# Incident Reports Service - Team Integration Contract

## 1. Service configuration

- Incident Service: http://localhost:3003
- Allocation Service: http://localhost:3001
- Inventory Service: http://localhost:3002
- Shared routing proxy: http://localhost:8080
- Floci: http://localhost:4566
- AWS region: us-east-1
- Frontend: shared HTML, CSS and JavaScript application

Shared proxy routing remains pending verification.

## 2. Authentication

Protected endpoints require:

Authorization: Bearer <Cognito access token>
Content-Type: application/json

Supported Cognito groups: user and admin.
Application identities must use the shared Cognito mapping.

## 3. Health check

GET /health

Public endpoint.
Expected HTTP status: 200.

Returns status, service and instanceId.

## 4. Submit incident

POST /api/incidents

Authentication required.

Example request:

{
  "description": "Vehicle parked in an unauthorized spot",
  "vehicle_plate": "ABC123",
  "spot_id": "A1",
  "incident_type": "unauthorized_parking",
  "turnstile_token": "<frontend challenge token>"
}

Field limits:
- description: 500 characters
- vehicle_plate: 20 characters
- spot_id: 50 characters
- incident_type: 50 characters
- turnstile_token: 2048 characters

Responses:
- 201: Incident created.
- 400: Invalid input or Turnstile rejection.
- 401: Invalid or missing authentication.
- 409: Duplicate incident within 10 minutes.
- 429: Rate limit exceeded.
- 503: Verification service unavailable.

The incident owner is derived from authentication,
not from a user_id supplied by the frontend.

Turnstile tokens must not be stored in incident records.

## 5. Verify QR permit

POST /api/incidents/verify

Authentication required.
Supported roles: user and admin.

Example request:

{
  "reservation_id": "res_123",
  "vehicle_plate": "ABC123",
  "spot_id": "A1"
}

All three fields are required.

Field limits:
- reservation_id: 128 characters
- vehicle_plate: 20 characters
- spot_id: 50 characters

Example response:

{
  "success": true,
  "data": {
    "reservation_id": "res_123",
    "result": "verified"
  }
}

Possible results:
- verified
- invalid_reservation
- plate_mismatch
- spot_mismatch

These results return HTTP 200.

HTTP 503 PERMIT_UNVERIFIED indicates that validity
could not be confirmed.

The reservation ID will be obtained from the QR permit.
Incident submission remains a separate function.

## 6. Allocation integration

GET /api/allocation/internal/reservations/:id/validity

Authorization: Bearer <INTERNAL_TOKEN>

Expected valid response:

{
  "success": true,
  "data": {
    "reservation_id": "res_123",
    "valid": true,
    "spot_id": "A1",
    "vehicle_plate": "ABC123"
  }
}

The Incident Service compares reservation ID, plate and spot.

An unavailable Allocation Service is not evidence of
illegal parking.

The proposed plate-and-spot lookup endpoint is not
implemented until Allocation confirms its final contract.

## 7. My Reports

GET /api/incidents

Returns reports owned by the authenticated user.
Supports pagination.

GET /api/incidents/:id

Returns an individual report belonging to the caller.
Ownership failure returns HTTP 404.

## 8. Admin Reports

GET /api/incidents/admin/reports

Admin role required.

Supported filters:
- status
- vehicle_plate
- spot_id

Supports pagination.

PATCH /api/incidents/:id/status

Admin role required.

Start investigation:

{
  "status": "under_review"
}

Resolve investigation:

{
  "status": "resolved",
  "resolution_notes": "Investigation completed."
}

Valid transitions:
open -> under_review -> resolved

Invalid transitions return HTTP 409.

## 9. Turnstile frontend contract

Only the incident submission form requires Turnstile.

The frontend sends the challenge token as turnstile_token.
The proposed widget action is incident_submit.

After a submission attempt, reset the widget and obtain
a fresh token before retrying.

Error codes:
- TURNSTILE_REQUIRED
- TURNSTILE_INVALID
- TURNSTILE_UNAVAILABLE

Only the public site key belongs in frontend code.
The secret key must remain on the backend.

## 10. Environment variables

Application:
- PORT
- INSTANCE_ID

AWS:
- AWS_REGION
- AWS_PROFILE
- DYNAMODB_ENDPOINT

DynamoDB:
- INCIDENT_REPORTS_TABLE
- INCIDENT_DUPLICATE_KEYS_TABLE
- PERMIT_VERIFICATION_LOGS_TABLE

Rate limiting:
- RATE_LIMIT_MAX
- RATE_LIMIT_WINDOW_MS

Cognito:
- AUTH_MODE
- COGNITO_REGION
- COGNITO_ENDPOINT
- COGNITO_USER_POOL_ID
- COGNITO_CLIENT_ID
- COGNITO_ISSUER
- COGNITO_JWKS_URL
- COGNITO_USERS_FILE
- COGNITO_USERS_JSON (alternative mapping source)

Allocation:
- ALLOCATION_URL
- INTERNAL_TOKEN

Secrets Manager:
- SECRETS_MANAGER_ENDPOINT
- RUNTIME_SECRET_ID

Turnstile:
- TURNSTILE_SECRET_KEY
- TURNSTILE_EXPECTED_HOSTNAME
- TURNSTILE_EXPECTED_ACTION

Frontend configuration:
- TURNSTILE_SITE_KEY (proposed public configuration name)

No secret values are included in this contract.

## 11. Cloud infrastructure

Individually configured:
- DynamoDB
- Cognito authentication implementation
- IAM roles and scoped policies
- Secrets Manager
- CloudWatch
- ECS Fargate task definition
- Application Auto Scaling configuration

Docker packaging and Floci connectivity tested.

Shared infrastructure:
- VPC
- Subnets
- Security groups
- ALB
- ECS cluster
- Cognito pool and app client
- Frontend hosting

## 12. Verification and limitations

149 automated backend tests passed.
3 live Cloudflare development-key tests passed.

Pending:
- Actual shared Cognito authentication.
- Live Allocation API integration.
- Shared internal token configuration.
- Incident frontend and Turnstile widget.
- Final runtime secret configuration.
- ECS service and Auto Scaling registration.
- Local proxy, performance and failover tests.

Native Fargate execution and production bot protection
have not been demonstrated.

Backend implementation milestone: 9d50b0e.

## Administrator Reservation Assessment

GET /api/incidents/:id/reservation-check

Authentication: Cognito access token.
Authorization: admin role required.

The Incident Service retrieves the stored incident from
DynamoDB and sends its vehicle plate and parking spot to:

GET /api/allocation/internal/reservations/lookup

Query parameters:
- vehicle_plate
- spot_id

Internal authentication:
Authorization: Bearer <INTERNAL_TOKEN>

Example successful response:

{
  "success": true,
  "data": {
    "incident_id": "inc-1",
    "result": "active_reservation_found",
    "reservation_id": "res_123",
    "checked_at": "2026-11-26T20:00:00.000Z"
  }
}

Possible successful results:
- active_reservation_found
- no_active_reservation

When no active reservation exists, reservation_id is null.

HTTP responses:
- 200: Reservation assessment completed.
- 401: Missing or invalid authentication.
- 403: Administrator permission required.
- 404: Incident not found.
- 429: Rate limit exceeded.
- 500: Internal database or application failure.
- 503: RESERVATION_UNVERIFIED.

The assessment checks current reservation validity,
not validity at the original incident time.

Allocation errors and connection failures must never
be interpreted as evidence of unauthorized parking.

The endpoint does not modify incident status.
Final investigation decisions remain with administrators.

Existing configuration is reused:
- ALLOCATION_URL
- INTERNAL_TOKEN

The previously documented pending lookup integration
is now implemented and individually tested using mocks.

Testing:
- 15 reservation lookup client tests passed.
- 7 administrator reservation assessment tests passed.
- Full automated backend suite: 171 passed, 0 failed.

Live Allocation integration remains pending.
