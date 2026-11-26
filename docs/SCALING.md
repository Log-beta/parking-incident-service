# Incident Service - Horizontal Scaling and Fault Tolerance

## Architecture

The local scaling environment consists of:

- Node.js and Express application workers.
- Three independent worker processes on ports 3113, 3114 and 3115.
- A round-robin HTTP proxy on port 8080.
- Shared DynamoDB test tables hosted by Floci.
- Simulated Cognito authentication using RS256 and a local JWKS endpoint.
- Runtime configuration retrieved from Secrets Manager.
- Grafana k6 for performance benchmarking.

The test environment is isolated from the existing service workers
and intended deployment configuration.

## Reproduction

From the repository root, start the scaling workers:

    node infra/local-scaling/start-workers.js

In a separate terminal, start the single-worker proxy:

    node infra/local-scaling/proxy.js 3113

Run the benchmark:

    k6 run infra/local-scaling/benchmark.js

Stop the proxy and start the three-worker configuration:

    node infra/local-scaling/proxy.js 3113 3114 3115

Run the same benchmark again.

The launcher requires Floci, the DynamoDB incident test tables,
the Floci AWS CLI profile and the isolated Turnstile test secret.

Generated access tokens are stored locally in the Git-ignored
.local directory. They must not be committed.

## Round-Robin Distribution

Nine sequential health requests were sent through the proxy.

| Worker | Requests |
|--------|----------|
| 3113 | 3 |
| 3114 | 3 |
| 3115 | 3 |

All nine requests succeeded.

## Performance Testing

Both configurations used:

- 20 concurrent virtual users.
- 30-second test duration.
- GET /api/incidents.
- Authenticated DynamoDB read operations.
- Identical benchmark scripts.
- Elevated test-only rate limits.

### Results

| Metric | Single Worker | Three Workers |
|--------|---------------|---------------|
| Virtual users | 20 | 20 |
| Duration | 30s | 30s |
| Total requests | 20,667 | 39,929 |
| Requests per second | 688.50 | 1,330.53 |
| Average latency | 28.88ms | 14.84ms |
| Minimum latency | 12.47ms | 5.66ms |
| Median latency | 28.08ms | 14.12ms |
| P95 latency | 37.17ms | 20.31ms |
| P99 latency | 43.95ms | 26.06ms |
| Maximum latency | 145.98ms | 451.58ms |
| Failed requests | 0 | 0 |
| Success rate | 100% | 100% |
| Successful checks | 41,334 | 79,858 |

### Analysis

Increasing the number of workers from one to three resulted in:

- 93.25% higher throughput.
- 48.61% lower average response time.
- 45.36% lower P95 response time.
- No failed requests in either configuration.

The three-worker configuration achieved better overall performance,
although its maximum observed latency was higher.

## Fault Tolerance Testing

Worker 3114 was deliberately terminated while the proxy remained
running.

Subsequent results:

| Test | Result |
|------|--------|
| Health requests | 12/12 successful |
| Authenticated database requests | 12/12 successful |
| Requests handled by worker 3113 during health test | 4 |
| Requests handled by worker 3115 during health test | 8 |
| Proxy restarted | No |

The proxy retried requests against available workers following
connection failures.

This demonstrated continued service availability following
the loss of an application worker.

## Limitations

- All workers ran on the same physical computer.
- Workers shared the same Floci database and proxy.
- One performance benchmark was conducted per configuration.
- Authentication used locally generated test identities and RSA keys.
- Rate limits were elevated only in the isolated benchmark environment.
- The proxy supports read-only benchmark endpoints.
- The failover mechanism does not automatically replace failed workers.
- Request distribution becomes uneven following a worker failure.
- Native AWS Fargate execution and automatic ECS scaling were not tested.
- Live integration with the shared team infrastructure remains pending.

## Deployment Separation

The local scaling launcher, proxy, benchmark scripts and test
resources are intended for development and testing only.

Production deployment must use the intended service tables,
shared authentication configuration and service infrastructure.

## Evidence

- incident-three-workers-running.png
- incident-round-robin-distribution.png
- incident-k6-single-worker.png
- incident-k6-three-workers.png
- incident-worker-failover.png
