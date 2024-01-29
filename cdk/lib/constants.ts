export const constants = {
  CLUSTER_NAME: process.env.CLUSTER_NAME ?? 'palworld',
  SERVICE_NAME: process.env.SERVICE_NAME ?? 'palworld-server',
  PALWORLD_SERVER_CONTAINER_NAME: 'palworld-server',
  WATCHDOG_SERVER_CONTAINER_NAME: 'palworld-ecsfargate-watchdog',
  DOMAIN_STACK_REGION: 'us-east-1',
  ECS_VOLUME_NAME: 'data',
  HOSTED_ZONE_SSM_PARAMETER: 'PalworldHostedZoneID',
  LAUNCHER_LAMBDA_ARN_SSM_PARAMETER: 'LauncherLambdaRoleArn',
  PALWORLD_DOCKER_IMAGE: 'jammsen/palworld-dedicated-server:latest',
  RCON_DOCKER_IMAGE: 'outdead/rcon:latest',
};
