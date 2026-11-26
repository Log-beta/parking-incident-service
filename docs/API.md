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