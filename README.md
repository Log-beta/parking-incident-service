# Parking Incident Service

A microservice responsible for parking incident management and permit
verification within the Cloud-Based Parking Allocation Management System.

## Features

- Create parking incident reports.
- Retrieve incident reports by ID.
- Verify parking reservations through the Allocation microservice.
- Detect invalid reservations, vehicle plate mismatches, and parking spot mismatches.
- Store incident reports and permit verification logs in DynamoDB.
- Handle external service and database failures.
- Support configurable ports and service instance identification.

## Technology Stack

- Node.js
- Express.js
- Amazon DynamoDB
- AWS SDK v3
- Docker
- Floci
- Node.js Test Runner

## Project Structure

```text
parking-incident-service/
├── docs/
│   └── API.md
├── src/
│   ├── config/
│   │   └── dynamodb.js
│   ├── controllers/
│   │   └── permitController.js
│   ├── repositories/
│   │   └── dynamodb/
│   │       ├── incidentRepository.js
│   │       └── permitVerificationRepository.js
│   ├── services/
│   │   ├── allocationClient.js
│   │   └── permitVerification.js
│   └── validation/
│       └── incidentValidation.js
├── test/
├── index.js
├── package.json
└── README.md
```

## Prerequisites

- Node.js
- npm
- Docker
- Floci
- AWS CLI with a configured Floci profile
- Required DynamoDB tables

## Installation

```powershell
npm.cmd install
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3003` | Service port. |
| `INSTANCE_ID` | Auto-generated | Unique service instance identifier. |
| `AWS_REGION` | `us-east-1` | AWS region. |
| `AWS_PROFILE` | Not explicitly set | AWS credentials profile. |
| `DYNAMODB_ENDPOINT` | `http://localhost:4566` | Local DynamoDB endpoint. |
| `INCIDENT_REPORTS_TABLE` | `IncidentReports` | Incident reports table. |
| `PERMIT_VERIFICATION_LOGS_TABLE` | `PermitVerificationLogs` | Verification logs table. |
| `ALLOCATION_URL` | `http://localhost:3001` | Allocation microservice URL. |
| `INTERNAL_TOKEN` | None | Authentication token required for Allocation requests. |

## Running Locally

Ensure Docker and Floci are running and the required DynamoDB tables exist.

```powershell
$env:AWS_PROFILE = "floci"
$env:PORT = "3003"
$env:PERMIT_VERIFICATION_LOGS_TABLE = "PermitVerificationLogs"

npm.cmd start
```

The service is available at:

```text
http://localhost:3003
```

To enable live permit verification, configure `ALLOCATION_URL` and
`INTERNAL_TOKEN` according to the Allocation microservice configuration.

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/` | Service welcome message. |
| GET | `/health` | Service health and instance information. |
| POST | `/api/incidents` | Create an incident report. |
| GET | `/api/incidents/:id` | Retrieve an incident report. |
| POST | `/api/incidents/verify` | Verify a parking permit. |

For detailed API documentation, see [docs/API.md](docs/API.md).

## DynamoDB Tables

| Table | Partition Key | Key Type |
| --- | --- | --- |
| `IncidentReports` | `incident_id` | String |
| `PermitVerificationLogs` | `verification_id` | String |

## Automated Testing

Run the automated test suite:

```powershell
npm.cmd test
```

### Current Test Results

- Total tests: 28
- Passed: 28
- Failed: 0
- Pass rate: 100%

The test suite covers incident validation, Allocation communication,
permit verification, repository operations, controller integration,
and database failure handling.

External dependencies are mocked during automated testing.

## Current Development Status

- [x] Express microservice setup
- [x] Health endpoint
- [x] Service instance identification
- [x] DynamoDB configuration
- [x] Incident report creation
- [x] Incident report retrieval
- [x] Incident input validation
- [x] Allocation client implementation
- [x] Permit verification logic
- [x] Permit verification logging
- [x] Automated testing
- [x] API documentation
- [ ] Live Allocation microservice integration

## Known Limitations

- Live integration with the team's Allocation microservice is pending.
- Verification logging failures do not interrupt API responses,
  but may result in missing audit records.
- Malformed verification requests are not logged.

## License

ISC
