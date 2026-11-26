# Parking Incident Service

A microservice responsible for incident reporting, parking permit
verification and administrative investigations within the Cloud-Based
Parking Allocation Management System.

## Business Functions

- Submit and retrieve parking incident reports.
- View personal incident report history.
- Prevent duplicate incident submissions through atomic DynamoDB transactions.
- Verify parking permits using reservation IDs.
- Investigate reservations using vehicle plates and parking spot IDs.
- Filter and paginate incident reports through administrator endpoints.
- Manage incident investigations through controlled status transitions.
- Record permit verification attempts.
- Protect incident submissions using Cloudflare Turnstile.

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js and Express | REST API and business logic |
| Amazon DynamoDB | Persistent NoSQL storage |
| Amazon Cognito | Authentication and role-based authorization |
| AWS Secrets Manager | Secure runtime configuration |
| AWS IAM | Scoped cloud permissions |
| Amazon CloudWatch | Logging infrastructure |
| Amazon ECS / Fargate | Target container deployment |
| Application Load Balancer | Target shared load balancing |
| Application Auto Scaling | Target scaling configuration |
| Amazon VPC | Target shared network infrastructure |
| Docker | Containerization |
| Floci | Local AWS-compatible environment |
| Cloudflare Turnstile | Automated submission protection |
| Grafana k6 | Performance testing |
| Node.js Test Runner | Automated testing |
| GitHub | Version control and collaboration |

## Project Structure

    parking-incident-service/
    |-- docs/
    |-- infra/
    |   |-- autoscaling/
    |   |-- cloudwatch/
    |   |-- dynamodb/
    |   |-- ecs/
    |   |-- iam/
    |   |-- local-scaling/
    |   `-- secretsmanager/
    |-- src/
    |   |-- config/
    |   |-- controllers/
    |   |-- middleware/
    |   |-- repositories/
    |   |-- services/
    |   |-- utils/
    |   `-- validation/
    |-- test/
    |-- bootstrap.js
    |-- index.js
    |-- Dockerfile
    |-- package.json
    `-- README.md

## Prerequisites

- Node.js 22 or a compatible newer version.
- npm.
- Docker.
- Floci.
- AWS CLI with a configured Floci profile.
- Required DynamoDB tables and indexes.
- Runtime configuration stored in Secrets Manager.
- Cognito configuration and identity mappings.
- Grafana k6 for performance benchmarking.

## Installation

    npm.cmd ci

## Configuration

Refer to .env.example for supported configuration variables.

The application requires Cognito configuration and identity mappings.
Runtime configuration is retrieved from Secrets Manager before the
application starts.

Important configuration groups:

| Configuration | Variables |
|---|---|
| Service | PORT, INSTANCE_ID |
| AWS | AWS_REGION, AWS_PROFILE |
| Database | DYNAMODB_ENDPOINT and table name variables |
| Authentication | AUTH_MODE and COGNITO_* variables |
| Secrets | SECRETS_MANAGER_ENDPOINT, RUNTIME_SECRET_ID |
| Allocation | ALLOCATION_URL, INTERNAL_TOKEN |
| Bot protection | TURNSTILE_SECRET_KEY and expected hostname/action |
| Rate limiting | RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS |

Environment variables must be supplied through the shell, container
configuration or deployment environment. The .env.example file is
a reference and is not loaded automatically.

Never commit actual credentials, private identity mappings or tokens.

## Running Locally

Start Docker and Floci, provision the required resources and configure
the environment before starting the service.

    npm.cmd start

The default service address is:

    http://localhost:3003

Verify service availability:

    curl.exe http://localhost:3003/health

The application must be started through bootstrap.js using npm start.
Direct execution of index.js is intentionally rejected.

## Docker

Build the container image:

    docker build -t parking-incidents:latest .

The image uses Node.js 22 Alpine, production dependencies, a non-root
user and the secure bootstrap startup process.

Container execution requires the appropriate runtime configuration.

## API Endpoints

| Method | Endpoint | Authorization |
|---|---|---|
| GET | / | Public |
| GET | /health | Public |
| POST | /api/incidents | Authenticated |
| GET | /api/incidents | Authenticated, owner-scoped |
| GET | /api/incidents/:id | Authenticated, owner only |
| POST | /api/incidents/verify | Authenticated |
| GET | /api/incidents/admin/reports | Administrator |
| PATCH | /api/incidents/:id/status | Administrator |
| GET | /api/incidents/:id/reservation-check | Administrator |

Incident submission additionally requires successful Turnstile
verification.

Incident status transitions:

    open -> under_review -> resolved

Reservation assessments do not automatically modify incident status
or determine that a vehicle is illegally parked.

## DynamoDB Resources

| Table | Partition Key |
|---|---|
| IncidentReports | incident_id |
| IncidentDuplicateKeys | duplicate_key |
| PermitVerificationLogs | verification_id |

IncidentReports includes the user_id-created_at-index global
secondary index for owner-scoped report retrieval.

Duplicate incident prevention uses a 10-minute expiration window
and conditional transactional writes.

Separate test tables are used during isolated development and
performance testing. They are not intended for final deployment.

## Security

- RS256 Cognito access token validation.
- JWT issuer, expiration, client ID and token type verification.
- Server-side identity mapping.
- Role-based authorization and incident ownership enforcement.
- Input validation and request body size restrictions.
- Per-worker sliding-window rate limiting.
- Secure HTTP response headers.
- Structured audit logging with restricted fields.
- Secrets Manager runtime configuration retrieval.
- Scoped IAM task and execution roles.
- Non-root Docker execution.
- Server-side Cloudflare Turnstile verification.
- Authenticated inter-service requests with timeout handling.

## Testing

Run the automated backend test suite:

    npm.cmd test

Audit production dependencies:

    npm.cmd audit --omit=dev

### Latest Recorded Results

| Metric | Result |
|---|---|
| Automated tests | 171 |
| Passed | 171 |
| Failed | 0 |
| Known production dependency vulnerabilities | 0 at time of audit |
| Docker runtime smoke test | Passed |
| Round-robin distribution | 9/9 requests successful |
| Worker failover | 24/24 requests successful |

External dependencies are mocked where appropriate in automated tests.
Additional local Floci and Docker runtime tests were conducted.

## Horizontal Scaling

Authenticated read benchmarks were conducted using 20 virtual users
over 30 seconds per configuration.

| Metric | Single Worker | Three Workers |
|---|---|---|
| Total requests | 20,667 | 39,929 |
| Requests per second | 688.50 | 1,330.53 |
| Average latency | 28.88ms | 14.84ms |
| P95 latency | 37.17ms | 20.31ms |
| Failed requests | 0 | 0 |

The three-worker configuration demonstrated approximately 93.25%
higher throughput and 48.61% lower average latency.

The experiment used local Node.js workers, a round-robin proxy and
shared Floci DynamoDB storage. It was not a native Fargate benchmark.

## Cloud Infrastructure Status

| Component | Status |
|---|---|
| DynamoDB | Provisioned and locally tested |
| Secrets Manager | Provisioned and runtime retrieval tested |
| IAM | Roles and policies provisioned; enforcement pending |
| CloudWatch | Log group and test log ingestion verified |
| Cognito | Backend implemented; shared pool integration pending |
| ECS | Task definition registered in Floci |
| Fargate | Deployment configuration prepared |
| Load balancing | Local equivalent tested |
| Auto Scaling | Policy prepared; manual horizontal scaling tested |
| VPC | Awaiting shared team infrastructure |

## Documentation

- [API Reference](docs/API.md)
- [Integration Guide](docs/INTEGRATION.md)
- [Horizontal Scaling and Fault Tolerance](docs/SCALING.md)
- [Security Implementation](docs/SECURITY.md)
- [Cloud Infrastructure and Deployment](docs/DEPLOYMENT.md)
- [Testing and Verification](docs/TESTING.md)

## Known Limitations and Pending Integration

- Live integration with both Allocation reservation APIs.
- Shared Cognito user pool and identity configuration.
- Shared ECS cluster, VPC and load balancer integration.
- Native Fargate execution and automatic ECS scaling.
- Actual IAM permission enforcement.
- Automatic application log delivery to CloudWatch.
- Proxy-aware client identification for rate limiting.
- Production Turnstile configuration and browser verification.
- Verification logging failures do not interrupt permit responses.
- Shared frontend development.
- Final deployment exclusion of development-only resources.

The individual backend has been implemented and tested locally.
Full integrated system deployment remains pending.

## License

ISC
