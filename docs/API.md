# Parking Incident Reports API

Local base URL: `http://localhost:3003/api/incidents`

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

A successful request returns `201 Created` with `success: true` and the saved
report inside `data`. The server generates `incident_id`, sets `status` to
`open`, and records `created_at` in UTC.

Invalid input returns `400 Bad Request` with the first applicable error code:
`DESCRIPTION_REQUIRED`, `VEHICLE_PLATE_REQUIRED`, `SPOT_ID_REQUIRED`, or
`INCIDENT_TYPE_REQUIRED`.

## Retrieve an incident

`GET /api/incidents/:id` returns `200 OK` with `success: true` and the stored
report inside `data`. Older reports can omit fields added after their creation.

An unknown ID returns `404 Not Found`:

```json
{"success":false,"error":{"code":"INCIDENT_NOT_FOUND","message":"Incident report not found."}}
```

## Verify a parking permit

`POST /api/incidents/verify`

Example request: `{"reservation_id":"res_123","vehicle_plate":"ABC123","spot_id":"A1"}`

`reservation_id` and `vehicle_plate` are required. Include `spot_id` when the occupied spot is known. Omit it to check only the reservation and plate.

| HTTP status | Meaning |
| --- | --- |
| 200 | The check completed. Read `data.result`: `verified`, `plate_mismatch`, `spot_mismatch`, or `invalid_reservation`. |
| 400 | A required field is missing or invalid, or the supplied spot ID is blank or invalid. |
| 503 | `PERMIT_UNVERIFIED`: reservation validity could not be confirmed. The frontend should show an unavailable result and allow a retry. |

Example response: `{"success":true,"data":{"reservation_id":"res_123","result":"plate_mismatch"}}`

Tested locally through the Incidents API with a mock Allocation service. Live team integration is pending.
