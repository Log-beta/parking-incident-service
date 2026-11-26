# Incident Service - Security Implementation

## Authentication

The service validates Cognito access tokens using:

- RS256 signature verification.
- JSON Web Key Set (JWKS) retrieval.
- Issuer and client ID validation.
- Token expiration validation.
- Access token type validation.
- Server-side identity mapping.
- JWKS caching with controlled refresh intervals.

Invalid credentials are rejected with HTTP 401.

Authentication has been individually tested using locally
generated RSA-signed tokens. Shared Cognito integration
remains pending.

## Authorization

The service implements role-based access control.

- Authenticated users can submit incident reports.
- Users can retrieve only their own incident reports.
- Authenticated users can verify parking permits.
- Administrators can retrieve and filter all incident reports.
- Administrators can manage incident status transitions.
- Administrators can perform reservation assessments.

Unauthorized administrator operations return HTTP 403.
Unauthorized access to another user's incident returns HTTP 404.

## Input Validation

Incident submission requires valid, nonblank strings.

| Field | Maximum Length |
|---|---|
| Description | 500 |
| Vehicle plate | 20 |
| Parking spot ID | 50 |
| Incident type | 50 |

Additional controls include:

- Rejection of angle brackets in incident fields.
- JSON request body size restrictions.
- Permit verification input validation.
- Pagination cursor validation.
- Parameterized DynamoDB expressions.
- Controlled incident status transitions.

Frontend output encoding must still be implemented during
shared frontend development.

## Rate Limiting

The service implements sliding-window rate limiting.

Default configuration:

- Maximum requests: 60.
- Time window: 60 seconds.
- Client identification: Request IP address.
- Scope: Individual application worker.
- Rejected requests: HTTP 429 with Retry-After header.

Health endpoints remain available independently of API limits.

Rate limits are not globally synchronized between workers.
Trusted proxy configuration must be finalized during integration.

## Duplicate Submission Prevention

Duplicate incident submissions are detected using a SHA-256
hash derived from the authenticated owner and incident fields.

A DynamoDB transaction atomically creates the duplicate key
and incident report.

Identical submissions within the 10-minute window are
rejected with HTTP 409.

Conditional writes prevent conflicting submissions from
being accepted by independent application workers.

## Cloudflare Turnstile

Incident submissions require server-side Turnstile verification.

The service handles:

- Missing verification tokens.
- Invalid verification tokens.
- Expired or reused verification tokens.
- External verification failures.
- Hostname and action mismatches when configured.

Cloudflare development-key verification has been tested.
Production keys, expected hostname, expected action and
browser-based verification remain pending integration.

## Secrets Management

Runtime configuration is retrieved from AWS Secrets Manager
before normal application startup.

Sensitive configuration includes:

- Internal Allocation authentication token.
- Cognito identity mappings.
- Cloudflare Turnstile secret key.

Only explicitly allowlisted configuration keys are loaded.

Direct execution of index.js is rejected to prevent
accidental startup without secure bootstrap initialization.

Private configuration files are excluded from Git and
the Docker build context.

## IAM

Separate ECS task and execution roles are provisioned.

The task role is scoped to required application resources.

The execution role contains the permissions needed for
the configured logging infrastructure.

Actual IAM permission enforcement remains pending
deployment verification.

## Inter-Service Security

Allocation requests use:

- Internal Bearer authentication.
- Encoded request parameters.
- Request timeouts.
- Redirect rejection.
- Response validation.
- Safe upstream failure handling.

Unavailable or malformed Allocation responses are treated
as unverified, never as evidence of unauthorized parking.

## Logging and Error Handling

Structured audit logging records security and business events.

Examples include:

- Authentication failures.
- Administrator access denials.
- Ownership violations.
- Rate limit violations.
- Duplicate incident rejection.
- Incident creation and status changes.
- Reservation assessments.
- Database failures.

Audit logging uses an explicit field allowlist.
Raw authentication tokens and credentials are not included
in the intended audit records.

Internal failures return controlled error responses rather
than exposing application stack traces.

## Container Security

The Docker image uses:

- Node.js 22 Alpine.
- Production-only npm dependencies.
- A non-root execution user.
- Secure bootstrap initialization.
- Exclusion of private local configuration.

The final container successfully retrieved runtime
configuration from Floci Secrets Manager and passed
its HTTP health check.

## Security Verification

| Check | Recorded Result |
|---|---|
| Automated backend tests | 171 passed, 0 failed |
| Production npm dependency audit | 0 known vulnerabilities |
| Sensitive tracked filename screening | No matches |
| Direct application startup protection | Passed |
| Docker non-root execution | Passed |
| Docker runtime smoke test | Passed |
| Source-level security review | Completed |

## Remaining Considerations

- Shared Cognito authentication testing.
- Production Turnstile configuration.
- Trusted proxy and client IP configuration.
- Per-worker rather than distributed rate limiting.
- IAM permission enforcement.
- Automatic CloudWatch application log delivery.
- Secure transport configuration in the final deployment.
- Dedicated resolution notes length restriction.
- Frontend output encoding.
- Verification logging failures may result in missing records.

The security review is not a penetration test.
Dependency auditing does not guarantee the absence of
all vulnerabilities, and filename screening does not
establish that the entire Git history is free of secrets.
