# Parking Incident Reports API

Local base URL: `http://localhost:3003/api/incidents`

## Authentication for incident reports

Creating, listing and retrieving reports require the `Authorization: Bearer <access-token>`
header. A missing, invalid or expired token returns `401 Unauthorized`. The service
uses the verified token's `sub` claim as the user ID.

## Create an incident

`POST /api/incidents` accepts a JSON body with four required, nonblank strings.

```json
{
  "description": "Vehicle parked in bay A1 without a visible permit",
  "vehicle_plate": "ABC123",
  "spot_id": "A1",
  "incident_type": "unauthorized_parking"
}
```

A successful request returns `201 Created` with the saved report in `data`.
The server assigns `user_id` from the token, generates `incident_id`, sets
`status` to `open`, and records `created_at` in UTC. A `user_id` supplied in
the body cannot override the owner.

Invalid input returns `400 Bad Request` with the first applicable error code:
`DESCRIPTION_REQUIRED`, `VEHICLE_PLATE_REQUIRED`, `SPOT_ID_REQUIRED`, or
`INCIDENT_TYPE_REQUIRED`.

### Duplicate incident protection

An identical incident submitted by the same authenticated user within
10 minutes returns `409 Conflict`.

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_INCIDENT",
    "message": "An identical incident was submitted within the last 10 minutes."
  }
}
```

Duplicate detection uses a SHA-256 hash of the following fields:

- Authenticated user ID.
- Vehicle plate.
- Parking spot ID.
- Incident type.
- Description.

Surrounding whitespace is removed from report fields. Vehicle plate
and parking spot comparisons remain case-sensitive.

Different users can independently report the same incident.
Generated incident IDs and timestamps are excluded from the hash.

### Duplicate protection storage

The service uses a DynamoDB transaction to atomically claim the
duplicate key and store the incident report. Either both writes
succeed or neither succeeds.

| Setting | Value |
| --- | --- |
| Main table | `IncidentDuplicateKeys` |
| Test table | `IncidentDuplicateKeysTest` |
| Partition key | `duplicate_key` (String) |
| Expiration attribute | `expires_at` (Number, epoch seconds) |
| Billing mode | `PAY_PER_REQUEST` |
| Protection window | 600 seconds |

A duplicate key can be reclaimed when its expiration timestamp is
less than or equal to the current timestamp. The condition does not
depend on automatic DynamoDB TTL deletion.

The table can be configured through `INCIDENT_DUPLICATE_KEYS_TABLE`.
The default is `IncidentDuplicateKeys`, or `IncidentDuplicateKeysTest`
when using `IncidentReportsTest`.

Provision either table using Git Bash:

```bash
bash infra/dynamodb/ensure-incident-duplicate-table.sh IncidentDuplicateKeys
bash infra/dynamodb/ensure-incident-duplicate-table.sh IncidentDuplicateKeysTest
```

Only a recognized duplicate-key condition failure returns HTTP 409.
Unrelated transaction failures and database outages return
`500 INCIDENT_SAVE_FAILED`.

### Duplicate protection verification

| Verification | Result |
| --- | --- |
| Duplicate-key generation tests | Passed |
| Atomic transaction construction | Passed |
| Duplicate conflict classification | Passed |
| Unrelated database failure handling (mocked) | Passed |
| Authenticated report ownership | Passed |
| Expiry condition and calculation (mocked) | Passed |
| First submission on test worker (3013) | HTTP 201 |
| Identical retry on test worker (3013) | HTTP 409 |
| Matching reports in returned test page | 1 |
| First submission on main worker (3003) | HTTP 201 |
| Identical retry on main worker (3003) | HTTP 409 |
| Full automated test suite | 66 passed, 0 failed |

Live tests were performed against DynamoDB on Floci using local
JWT authentication. Live expiry-boundary enforcement, concurrent
submission testing and final team authentication integration
remain to be verified.


## List my reports

`GET /api/incidents` returns up to 25 reports belonging to the signed-in user,
newest first. A `user_id` query parameter is ignored. A user with no reports
receives `200 OK` with an empty list:

```json
{"success":true,"data":{"items":[],"next_cursor":null}}
```

If `data.next_cursor` contains a string, pass it back URL-encoded as `cursor`
on the next request: `GET /api/incidents?cursor=<encoded-cursor>`.
Use the same signed-in user for each page. Stop when `next_cursor` is `null`.
A malformed cursor or one belonging to another user returns `400 INVALID_CURSOR`.

## Retrieve an incident

`GET /api/incidents/:id` returns `200 OK` with `success: true` and the stored
report inside `data` when the signed-in user owns it.

An unknown ID, another user's report, or an older report without an owner
returns the same `404 Not Found` response:

```json
{"success":false,"error":{"code":"INCIDENT_NOT_FOUND","message":"Incident report not found."}}
```

## Verify a parking permit

`POST /api/incidents/verify`

### Example request

```json
{
  "reservation_id": "res_123",
  "vehicle_plate": "ABC123",
  "spot_id": "A1"
}
```

`reservation_id` and `vehicle_plate` are required. Include `spot_id`
when the occupied spot is known. Omit it to check only the reservation
and plate.

### Response status codes

| HTTP status | Meaning |
| --- | --- |
| 200 | The check completed. Read `data.result`: `verified`, `plate_mismatch`, `spot_mismatch`, or `invalid_reservation`. |
| 400 | A required field is missing or invalid, or the supplied spot ID is blank or invalid. |
| 503 | `PERMIT_UNVERIFIED`: reservation validity could not be confirmed. The frontend should show an unavailable result and allow a retry. |

### Example response

```json
{
  "success": true,
  "data": {
    "reservation_id": "res_123",
    "result": "plate_mismatch"
  }
}
```

Tested locally through the Incidents API with a mock Allocation service.
Live team integration is pending.

## Permit verification logging

Every permit verification attempt that passes request validation triggers
a logging operation in the `PermitVerificationLogs` DynamoDB table.

### Verification outcomes

| Result | Description |
| --- | --- |
| `verified` | The reservation and presented details match. |
| `invalid_reservation` | The reservation is confirmed to be invalid. |
| `plate_mismatch` | The presented vehicle plate does not match the reservation. |
| `spot_mismatch` | The presented parking spot does not match the reservation. |
| `unverified` | Reservation validity could not be confirmed. |

### Database structure

Table name: `PermitVerificationLogs`

Partition key: `verification_id` (String)

Billing mode: `PAY_PER_REQUEST`

| Attribute | Type | Description |
| --- | --- | --- |
| `verification_id` | String | Unique UUID and partition key. |
| `reservation_id` | String | Reservation being verified. |
| `vehicle_plate` | String | Presented vehicle license plate. |
| `spot_id` | String | Optional parking spot identifier. |
| `result` | String | Outcome of the verification attempt. |
| `created_at` | String | UTC timestamp in ISO 8601 format. |

### Example stored record

```json
{
  "verification_id": "5bba9e2e-0613-47c0-aed8-0ca7a72dac37",
  "reservation_id": "TEST-001",
  "vehicle_plate": "ABC-123",
  "spot_id": "A-01",
  "result": "unverified",
  "created_at": "2026-11-25T22:40:05.324Z"
}
```

### Configuration

| Environment variable | Default value |
| --- | --- |
| `PERMIT_VERIFICATION_LOGS_TABLE` | `PermitVerificationLogs` |

The repository uses the shared DynamoDB client configuration.

To explicitly configure the table in PowerShell:

```powershell
$env:PERMIT_VERIFICATION_LOGS_TABLE = "PermitVerificationLogs"
```

### Error handling

Malformed requests returning HTTP 400 are not logged.

If DynamoDB logging fails, the error is recorded in the server console,
and the API continues to return the original verification response.

This preserves service availability but may result in missing audit
records during database outages.

### Testing

The following functionality is covered by automated tests:

- All five verification outcomes.
- Verification without an optional parking spot.
- Unique verification ID generation.
- UTC timestamp generation.
- DynamoDB repository operations.
- Database failure handling.
- Malformed request handling.
- Existing incident management functionality.

Run the automated tests using:

```powershell
npm.cmd test
```

Current test results:

| Metric | Result |
| --- | --- |
| Total tests | 28 |
| Passed | 28 |
| Failed | 0 |
| Pass rate | 100% |

Live logging of an unverified permit attempt was successfully confirmed
using Floci and DynamoDB.

Automated controller and repository tests use mocked external dependencies.

Live integration with the actual Allocation microservice remains pending.

## Investigate and resolve an incident

`PATCH /api/incidents/:id/status` requires a Bearer token with the `admin` role.
Send a JSON body with `Content-Type: application/json`.

| Current status | Request body | Result |
| --- | --- | --- |
| `open` | `{"status":"under_review"}` | Starts the investigation and records `updated_by` and `updated_at`. |
| `under_review` | `{"status":"resolved","resolution_notes":"Vehicle moved and bay A1 is clear."}` | Saves the trimmed note, `resolved_by` and `resolved_at`, and updates `updated_by` and `updated_at`. |

Both transitions return `200 OK` with the updated incident in `data`.
The backend takes the admin ID from the verified token and generates the UTC timestamps.

| HTTP status | When it occurs |
| --- | --- |
| `400` | Unsupported status, or a resolution note is missing, blank, or not a string. |
| `401` | The token is missing or invalid. |
| `403` | The signed-in user lacks the admin role. |
| `404` | The incident ID does not exist. |
| `409` | The current status prevents the transition. Retrying a completed resolution returns `STATUS_CONFLICT` and preserves the original note. |

## List reports for the admin dashboard

`GET /api/incidents/admin/reports` requires a Bearer token with the `admin` role.
It lists reports across owners. To filter by status, use `open`, `under_review`,
or `resolved`. Use `vehicle_plate` and `spot_id` for exact, case-sensitive matches.
Surrounding spaces are trimmed. Each filter is optional. When combining filters,
a report must match all of them. For example:

`GET /api/incidents/admin/reports?status=resolved&vehicle_plate=TEST123&spot_id=A1`.

A successful request returns `200 OK` with `data.items` and `data.next_cursor`.
A filtered page can have zero items and still have a cursor. Continue with the
same filters and URL-encode the cursor. When changing any filter, start without a cursor. Stop when `next_cursor` is `null`.

| HTTP status | Meaning |
| --- | --- |
| `400` | `INVALID_STATUS` for an unsupported status, `INVALID_VEHICLE_PLATE` for a blank or invalid plate filter, `INVALID_SPOT_ID` for a blank or invalid spot filter, or `INVALID_CURSOR` for a malformed cursor or one used with a different filter. |
| `401` | A valid access token is required. |
| `403` | The signed-in user lacks the admin role. |

## API security headers

All API responses include the following security controls:

| Header | Value |
| --- | --- |
| X-Content-Type-Options | nosniff |
| X-Frame-Options | DENY |
| Content-Security-Policy | default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none' |
| Referrer-Policy | no-referrer |
| X-Powered-By | Removed |

The restrictive Content Security Policy is intended for the JSON API.
The frontend will require a separate policy.

### Verification

- Security headers on successful requests: Passed.
- Security headers on authentication failures: Passed.
- Full automated test suite: 68 passed, 0 failed.
- Live HTTP verification on worker 3013: Passed.
- Main worker security header verification: Pending.

Evidence: incident-security-headers-live.png

These controls follow the layered security approach introduced in Lab 8.
