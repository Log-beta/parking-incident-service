# Incident Service - Cloud Infrastructure and Deployment

## Architecture Overview

The Incident Service is designed as an independently deployable
containerized microservice within the Parking Allocation Management
System.

The target cloud architecture uses:

- Amazon ECS with Fargate.
- Application Load Balancer.
- Amazon VPC.
- Application Auto Scaling.
- Amazon DynamoDB.
- Amazon Cognito.
- AWS Secrets Manager.
- AWS IAM.
- Amazon CloudWatch.

Individual development and infrastructure testing were performed
using Docker and Floci.

## AWS Resource Inventory

| AWS Service | Resource | Implementation Status |
|---|---|---|
| DynamoDB | IncidentReports | Provisioned and tested locally |
| DynamoDB | IncidentDuplicateKeys | Provisioned and tested locally |
| DynamoDB | PermitVerificationLogs | Provisioned and tested locally |
| Secrets Manager | parking/incidents/runtime | Provisioned and retrieval tested |
| IAM | parking-incidents-task-role | Provisioned |
| IAM | parking-incidents-execution-role | Provisioned |
| CloudWatch | /ecs/parking-incidents | Provisioned and test ingestion verified |
| ECS | parking-incidents task definition | Registered in Floci |
| ECS | Incident service | Provisioning script prepared |
| Cognito | Shared user pool | Backend ready; integration pending |
| Fargate | Container execution | Configuration prepared |
| ALB | Shared load balancer and target group | Integration pending |
| Auto Scaling | CPU target tracking policy | Configuration prepared |
| VPC | Shared network infrastructure | Team dependency |

## DynamoDB

### IncidentReports

Stores incident reports and investigation information.

Partition key: incident_id (String).

Global secondary index:

- Name: user_id-created_at-index.
- Partition key: user_id.
- Sort key: created_at.

The index supports efficient owner-scoped report retrieval.

### IncidentDuplicateKeys

Prevents duplicate incident submissions through transactional
conditional writes.

Partition key: duplicate_key (String).

Duplicate records contain an expires_at attribute and enforce
a 10-minute duplicate prevention window.

### PermitVerificationLogs

Stores parking permit verification attempts and their results.

Partition key: verification_id (String).

## Secrets Manager

Runtime secret:

    parking/incidents/runtime

The application retrieves runtime configuration before startup.

Configuration can include:

- Rate limiting settings.
- Allocation service URL.
- Internal authentication token.
- Cognito identity mappings.
- Turnstile verification configuration.

The repository contains a configuration example rather than
actual production credentials.

## IAM

Two separate roles are maintained:

### Task Role

    parking-incidents-task-role

Provides scoped application access to required DynamoDB
resources and runtime secrets.

### Execution Role

    parking-incidents-execution-role

Provides permissions for the configured ECS logging
infrastructure.

IAM roles and policies were provisioned in Floci.
Actual permission enforcement remains pending verification.

## CloudWatch

Log group:

    /ecs/parking-incidents

Retention period: 14 days.

The application produces structured JSON audit logs.

CloudWatch connectivity was verified by submitting and
retrieving a synthetic test log event.

Automatic delivery of application logs through ECS remains
pending shared deployment.

## ECS and Fargate

Task definition family:

    parking-incidents

Configured resources:

| Setting | Value |
|---|---|
| Launch type | FARGATE |
| Network mode | awsvpc |
| CPU | 256 units |
| Memory | 512 MiB |
| Container port | 3003 |
| Container image | parking-incidents:latest |

The ECS task definition was registered in Floci.

The service provisioning script requires the shared cluster,
target group, subnet IDs and security group.

Native Fargate task execution has not been demonstrated.

## Application Auto Scaling

The prepared configuration specifies:

| Setting | Value |
|---|---|
| Initial desired task count | 1 |
| Minimum task count | 1 |
| Maximum task count | 4 |
| Target CPU utilization | 50% |
| Scale-out cooldown | 60 seconds |
| Scale-in cooldown | 120 seconds |

The scaling configuration is intended for the shared ECS service.

Manual horizontal scaling was successfully demonstrated with
one and three independent local Node.js workers.

Automatic ECS scaling has not yet been verified.

## Load Balancing and Fault Tolerance

A local round-robin proxy was implemented to demonstrate
request distribution and worker failover.

Three workers successfully shared the same DynamoDB test
storage.

The three-worker configuration achieved:

- 93.25% higher throughput.
- 48.61% lower average response time.
- Zero failed benchmark requests.

After terminating one worker, all 24 subsequent health
and authenticated requests succeeded.

The local proxy is a benchmark implementation, not an
actual AWS Application Load Balancer.

See SCALING.md for detailed results.

## Docker

Build command:

    docker build -t parking-incidents:latest .

The image uses Node.js 22 Alpine and runs as a non-root user.

Recorded final image verification:

| Metric | Result |
|---|---|
| Disk usage | 279 MB |
| Content size | 66.6 MB |
| User ID | 1000 |
| Startup command | node bootstrap.js |
| Syntax validation | Passed |
| Secrets Manager runtime retrieval | Passed |
| HTTP health check | Passed |

The image is available locally. Publishing to a shared
container registry remains a deployment decision.

## Infrastructure Files

| File | Purpose |
|---|---|
| infra/ecs/task-definition.json | ECS task configuration |
| infra/ecs/provision-service.ps1 | Service and scaling provisioning |
| infra/autoscaling/cpu-policy.json | CPU-based scaling policy |
| infra/iam/ecs-trust-policy.json | ECS role trust configuration |
| infra/iam/task-permissions.json | Application permissions |
| infra/iam/execution-permissions.json | Execution permissions |
| infra/cloudwatch/log-config.json | CloudWatch logging configuration |
| infra/dynamodb/create-user-reports-index.json | DynamoDB secondary index |
| infra/dynamodb/ensure-user-reports-index.sh | Index provisioning |
| infra/dynamodb/ensure-incident-duplicate-table.sh | Duplicate table provisioning |
| infra/secretsmanager/runtime-config.example.json | Runtime configuration example |
| infra/local-scaling/ | Isolated scaling and benchmarking |

## Shared Integration Checklist

- [ ] Confirm shared Cognito configuration.
- [ ] Configure actual user identity mappings.
- [ ] Configure Allocation URL and internal authentication.
- [ ] Test both Allocation endpoints against the live service.
- [ ] Confirm shared VPC, subnets and security groups.
- [ ] Confirm shared ECS cluster and target group.
- [ ] Finalize container image distribution.
- [ ] Provision Incident ECS service and scaling configuration.
- [ ] Verify IAM permission enforcement.
- [ ] Verify automatic CloudWatch application log delivery.
- [ ] Configure trusted proxy handling and secure transport.
- [ ] Configure production Turnstile credentials and validation.
- [ ] Complete integrated frontend development.
- [ ] Conduct end-to-end system testing.
- [ ] Exclude development-only resources from final deployment.

## Development Resource Separation

Development-only resources include:

- IncidentReportsTest.
- IncidentDuplicateKeysTest.
- parking/incidents/turnstile-test.
- Locally generated authentication tokens.
- Isolated scaling workers and benchmark proxy.

These resources are not intended for the final deployment.

Testing resources should only be removed after evidence
collection and confirmation that they are no longer required.

## Deployment Limitations

Floci was used as the local AWS-compatible environment.

Resource provisioning and application connectivity tests
do not establish that native AWS infrastructure is running.

Shared infrastructure must not be duplicated independently
by individual team members.

Final integrated deployment requires coordination with
the Allocation and Inventory service owners.
