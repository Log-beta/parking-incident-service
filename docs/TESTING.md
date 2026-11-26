# Incident Service - Testing and Verification

## Testing Strategy

The Incident Service was evaluated through:

- Automated unit testing.
- API integration testing with mocked dependencies.
- Local Floci infrastructure testing.
- Security and dependency auditing.
- Docker runtime testing.
- Performance benchmarking.
- Load balancing and fault tolerance testing.

## Automated Testing

Command:

    npm.cmd test

Final recorded results:

| Metric | Result |
|---|---|
| Total tests | 171 |
| Passed | 171 |
| Failed | 0 |
| Skipped | 0 |
| Cancelled | 0 |
| Pass rate | 100% |
| Final recorded execution time | 1.30 seconds |

## Functional Test Coverage

| Function | Verified Behaviour |
|---|---|
| Incident submission | Valid reports accepted |
| Input validation | Missing, oversized and unsafe fields rejected |
| Incident ownership | Unauthorized report access denied |
| Personal report history | Owner-scoped retrieval and pagination |
| Duplicate prevention | Identical submissions rejected |
| Admin report listing | Filtering and pagination |
| Incident investigation | Controlled status transitions |
| Permit verification | Reservation, plate and spot validation |
| Reservation lookup | Active reservation assessment |
| External service failure | Safe unverified responses |
| Database failure | Controlled error responses |
| Turnstile | Submission verification and failure handling |

## Security Testing

| Test | Recorded Result |
|---|---|
| Invalid authentication | HTTP 401 |
| Unauthorized admin access | HTTP 403 |
| Unauthorized incident access | HTTP 404 |
| Duplicate incident submission | HTTP 409 |
| Invalid incident status transition | HTTP 409 |
| Rate limit exceeded | HTTP 429 |
| Allocation unavailable | HTTP 503 |
| Turnstile unavailable | HTTP 503 |
| Direct startup without bootstrap | Rejected |
| Production dependency audit | 0 known vulnerabilities |
| Sensitive tracked filename screening | No matches |
| Docker non-root execution | Verified |

Security tests included mocked dependencies and locally
generated RSA-signed access tokens.

Shared Cognito and live Allocation integration remain
pending.

## Allocation Integration Testing

Two Allocation API clients were implemented.

1. Reservation validity verification using a reservation ID.
2. Active reservation lookup using vehicle plate and spot ID.

The reservation lookup implementation added:

- 15 client tests.
- 7 administrator reservation assessment tests.

All 22 additional tests passed.

Unavailable Allocation services are never interpreted
as evidence of unauthorized parking.

## AWS Infrastructure Verification

| Component | Verification | Result |
|---|---|---|
| DynamoDB | Local database operations | Passed |
| DynamoDB | Duplicate prevention transactions | Passed |
| Secrets Manager | Runtime configuration retrieval | Passed |
| IAM | Role and policy provisioning | Passed |
| CloudWatch | Synthetic log event ingestion | Passed |
| ECS | Task definition registration | Passed |
| Cognito | Simulated token authentication | Passed |

These infrastructure checks were conducted using Floci.

Actual IAM enforcement, automatic CloudWatch application
log delivery and native Fargate execution remain unverified.

## Turnstile Verification

Cloudflare development keys were tested against the
Cloudflare Siteverify endpoint.

| Scenario | Result |
|---|---|
| Successful verification | Passed |
| Failed verification | Passed |
| Expired or duplicate token simulation | Passed |

These tests used official development credentials rather
than production browser-generated tokens.

## Performance Benchmarking

Tool: Grafana k6.

Workload:

- 20 concurrent virtual users.
- 30 seconds per configuration.
- Authenticated GET /api/incidents requests.
- Shared DynamoDB test storage.
- Identical benchmark scripts.

| Metric | Single Worker | Three Workers |
|---|---|---|
| Total requests | 20,667 | 39,929 |
| Throughput (requests/s) | 688.50 | 1,330.53 |
| Average latency | 28.88ms | 14.84ms |
| Median latency | 28.08ms | 14.12ms |
| P95 latency | 37.17ms | 20.31ms |
| P99 latency | 43.95ms | 26.06ms |
| Maximum latency | 145.98ms | 451.58ms |
| Failed requests | 0 | 0 |
| Success rate | 100% | 100% |

Three-worker throughput increased by approximately 93.25%.

Average response time decreased by approximately 48.61%.

Both configurations passed the configured k6 thresholds.

See SCALING.md for full benchmark details and reproduction
instructions.

## Load Balancing

Nine sequential health requests were distributed across
three independent application workers.

| Worker | Requests |
|---|---|
| 3113 | 3 |
| 3114 | 3 |
| 3115 | 3 |

All nine requests succeeded.

## Fault Tolerance

Worker 3114 was deliberately terminated.

| Test | Result |
|---|---|
| Health requests | 12/12 successful |
| Authenticated database requests | 12/12 successful |
| Total successful requests | 24/24 |
| Proxy restart required | No |

The remaining workers continued serving requests.

Automatic replacement of failed workers was not tested.

## Final Docker Verification

| Verification | Result |
|---|---|
| Image build | Passed |
| Image ID | 5b83ad55e189 |
| Disk usage | 279 MB |
| Content size | 66.6 MB |
| Non-root user | UID 1000 |
| Application syntax | Passed |
| Secure bootstrap | Passed |
| Secrets Manager retrieval | Passed |
| Container health endpoint | Passed |

The temporary smoke-test container was removed after
verification.

## Evidence Reference

Suggested screenshot filenames:

| Evidence | Filename |
|---|---|
| Secrets Manager creation | incident-secrets-manager-created.png |
| Secrets Manager retrieval | incident-secrets-manager-retrieval.png |
| IAM roles and policies | incident-iam-roles-policies.png |
| CloudWatch log group | incident-cloudwatch-log-group.png |
| CloudWatch ingestion | incident-cloudwatch-log-ingestion.png |
| ECS task definition | incident-ecs-task-definition.png |
| Turnstile verification | incident-turnstile-live-verification.png |
| Automated regression tests | incident-reservation-lookup-171-tests.png |
| Three application workers | incident-three-workers-running.png |
| Round-robin distribution | incident-round-robin-distribution.png |
| Single-worker benchmark | incident-k6-single-worker.png |
| Three-worker benchmark | incident-k6-three-workers.png |
| Worker failover | incident-worker-failover.png |
| Security audit | incident-final-security-audit.png |
| Final Docker image | incident-final-docker-image.png |
| Container runtime | incident-docker-runtime-verification.png |

This table is an evidence collection reference, not
confirmation that every screenshot has been archived.

## Outstanding Integration Tests

- [ ] Live shared Cognito authentication.
- [ ] Live reservation validity API.
- [ ] Live plate-and-spot reservation lookup API.
- [ ] Shared load balancer and routing.
- [ ] IAM permission enforcement.
- [ ] Automatic application log delivery.
- [ ] Integrated frontend and Turnstile verification.
- [ ] End-to-end parking system workflows.

## Testing Limitations

Automated tests mock external dependencies where appropriate.

Local infrastructure tests use Floci rather than native AWS.

Performance benchmarks were conducted on one computer,
with one recorded run per configuration and elevated
test-only rate limits.

The results demonstrate local functionality and scalability,
but do not establish production capacity or availability.

The security assessment is not a penetration test.
