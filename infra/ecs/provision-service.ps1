param(
    [Parameter(Mandatory=$true)]
    [string]$SubnetIds,

    [Parameter(Mandatory=$true)]
    [string]$SecurityGroupId
)

$ErrorActionPreference = "Stop"

$awsArgs = @(
    "--endpoint-url", "http://localhost:4566",
    "--profile", "floci",
    "--region", "us-east-1"
)

$cluster = aws ecs describe-clusters `
    --clusters parking-cluster `
    --query "clusters[0].status" `
    --output text @awsArgs

if ($LASTEXITCODE -ne 0 -or $cluster -ne "ACTIVE") {
    throw "Shared parking-cluster is unavailable."
}

$targetGroup = aws elbv2 describe-target-groups `
    --names parking-incidents-tg `
    --query "TargetGroups[0].TargetGroupArn" `
    --output text @awsArgs

if ($LASTEXITCODE -ne 0 -or !$targetGroup -or $targetGroup -eq "None") {
    throw "Shared incident target group is unavailable."
}

aws ecs create-service `
    --cluster parking-cluster `
    --service-name parking-incidents `
    --task-definition parking-incidents `
    --desired-count 1 `
    --launch-type FARGATE `
    --network-configuration "awsvpcConfiguration={subnets=[$SubnetIds],securityGroups=[$SecurityGroupId],assignPublicIp=DISABLED}" `
    --load-balancers "targetGroupArn=$targetGroup,containerName=parking-incidents,containerPort=3003" `
    @awsArgs

if ($LASTEXITCODE -ne 0) {
    throw "ECS service creation failed."
}

aws application-autoscaling register-scalable-target `
    --service-namespace ecs `
    --resource-id service/parking-cluster/parking-incidents `
    --scalable-dimension ecs:service:DesiredCount `
    --min-capacity 1 `
    --max-capacity 4 `
    @awsArgs

if ($LASTEXITCODE -ne 0) {
    throw "Scaling target registration failed."
}

aws application-autoscaling put-scaling-policy `
    --policy-name parking-incidents-cpu-scaling `
    --service-namespace ecs `
    --resource-id service/parking-cluster/parking-incidents `
    --scalable-dimension ecs:service:DesiredCount `
    --policy-type TargetTrackingScaling `
    --target-tracking-scaling-policy-configuration file://infra/autoscaling/cpu-policy.json `
    @awsArgs

if ($LASTEXITCODE -ne 0) {
    throw "Scaling policy creation failed."
}
