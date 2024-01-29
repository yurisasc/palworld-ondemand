import * as path from 'path';
import {
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_efs as efs,
  aws_iam as iam,
  aws_ecs as ecs,
  aws_logs as logs,
  aws_sns as sns,
  RemovalPolicy,
  Arn,
  ArnFormat,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { constants } from './constants';
import { SSMParameterReader } from './ssm-parameter-reader';
import { StackConfig } from './types';
import {
  getPalworldServerConfig as getPalworldServerConfig,
  isDockerInstalled,
} from './util';

interface PalworldStackProps extends StackProps {
  config: Readonly<StackConfig>;
}

export class PalworldStack extends Stack {
  constructor(scope: Construct, id: string, props: PalworldStackProps) {
    super(scope, id, props);

    const { config } = props;

    const vpc = config.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: config.vpcId })
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 3,
          natGateways: 0,
        });

    const fileSystem = new efs.FileSystem(this, 'FileSystem', {
      vpc,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    const accessPoint = new efs.AccessPoint(this, 'AccessPoint', {
      fileSystem,
      path: '/palworld',
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '0755',
      },
    });

    const efsReadWriteDataPolicy = new iam.Policy(this, 'DataRWPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowReadWriteOnEFS',
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:DescribeFileSystems',
          ],
          resources: [fileSystem.fileSystemArn],
          conditions: {
            StringEquals: {
              'elasticfilesystem:AccessPointArn': accessPoint.accessPointArn,
            },
          },
        }),
      ],
    });

    const ecsTaskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Palworld ECS task role',
    });

    efsReadWriteDataPolicy.attachToRole(ecsTaskRole);

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: constants.CLUSTER_NAME,
      vpc,
      containerInsights: true, // TODO: Add config for container insights
      enableFargateCapacityProviders: true,
    });

    const palworldTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'PalworldTaskDefinition',
      {
        taskRole: ecsTaskRole,
        memoryLimitMiB: config.taskMemory,
        cpu: config.taskCpu,
        volumes: [
          {
            name: constants.ECS_VOLUME_NAME,
            efsVolumeConfiguration: {
              fileSystemId: fileSystem.fileSystemId,
              transitEncryption: 'ENABLED',
              authorizationConfig: {
                accessPointId: accessPoint.accessPointId,
                iam: 'ENABLED',
              },
            },
          },
        ],
      }
    );

    const palwordServerConfig = getPalworldServerConfig(config.rconPassword);

    const palworldServerContainer = new ecs.ContainerDefinition(
      this,
      'ServerContainer',
      {
        containerName: constants.PALWORLD_SERVER_CONTAINER_NAME,
        image: ecs.ContainerImage.fromRegistry(
          palwordServerConfig.server.image
        ),
        portMappings: [
          {
            containerPort: palwordServerConfig.server.port,
            hostPort: palwordServerConfig.server.port,
            protocol: palwordServerConfig.server.protocol,
          },
          ...config.extraTcpPorts.map(port => ({
            containerPort: port,
            hostPort: port,
            protocol: ecs.Protocol.TCP,
          })),
          ...config.extraUdpPorts.map(port => ({
            containerPort: port,
            hostPort: port,
            protocol: ecs.Protocol.UDP,
          })),
        ],
        environment: config.palworldImageEnv,
        essential: false,
        taskDefinition: palworldTaskDefinition,
        logging: config.debug
          ? new ecs.AwsLogDriver({
              logRetention: logs.RetentionDays.THREE_DAYS,
              streamPrefix: constants.PALWORLD_SERVER_CONTAINER_NAME,
            })
          : undefined,
      }
    );

    palworldServerContainer.addMountPoints({
      containerPath: '/data',
      sourceVolume: constants.ECS_VOLUME_NAME,
      readOnly: false,
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      'ServiceSecurityGroup',
      {
        vpc,
        description: 'Security group for Palworld on-demand',
      }
    );

    // Ingress rules for Palworld server, RCON, and extra ports
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      palwordServerConfig.server.ingressRulePort
    );
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      palwordServerConfig.rcon.ingressRulePort
    );
    config.extraTcpPorts.forEach(port => {
      serviceSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(port)
      );
    });
    config.extraUdpPorts.forEach(port => {
      serviceSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.udp(port)
      );
    });

    const palworldServerService = new ecs.FargateService(
      this,
      'FargateService',
      {
        cluster,
        capacityProviderStrategies: [
          {
            capacityProvider: config.useFargateSpot
              ? 'FARGATE_SPOT'
              : 'FARGATE',
            weight: 1,
            base: 1,
          },
        ],
        taskDefinition: palworldTaskDefinition,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        serviceName: constants.SERVICE_NAME,
        desiredCount: 0,
        assignPublicIp: true,
        securityGroups: [serviceSecurityGroup],
        enableExecuteCommand: true,
      }
    );

    /* Allow access to EFS from Fargate service security group */
    fileSystem.connections.allowDefaultPortFrom(
      palworldServerService.connections
    );

    const hostedZoneId = new SSMParameterReader(
      this,
      'Route53HostedZoneIdReader',
      {
        parameterName: constants.HOSTED_ZONE_SSM_PARAMETER,
        region: constants.DOMAIN_STACK_REGION,
      }
    ).getParameterValue();

    let snsTopicArn = '';
    /* Create SNS Topic if SNS_EMAIL is provided */
    if (config.snsEmailAddress) {
      const snsTopic = new sns.Topic(this, 'ServerSnsTopic', {
        displayName: 'Palworld Server Notifications',
      });

      snsTopic.grantPublish(ecsTaskRole);

      const emailSubscription = new sns.Subscription(
        this,
        'EmailSubscription',
        {
          protocol: sns.SubscriptionProtocol.EMAIL,
          topic: snsTopic,
          endpoint: config.snsEmailAddress,
        }
      );
      snsTopicArn = snsTopic.topicArn;
    }

    const watchdogContainer = new ecs.ContainerDefinition(
      this,
      'WatchDogContainer',
      {
        containerName: constants.WATCHDOG_SERVER_CONTAINER_NAME,
        image: ecs.ContainerImage.fromRegistry(
          'yurisasc/palworld-ecsfargate-watchdog'
        ),
        essential: true,
        taskDefinition: palworldTaskDefinition,
        environment: {
          CLUSTER: constants.CLUSTER_NAME,
          SERVICE: constants.SERVICE_NAME,
          DNSZONE: hostedZoneId,
          SERVERNAME: `${config.subdomainPart}.${config.domainName}`,
          SNSTOPIC: snsTopicArn,
          TWILIOFROM: config.twilio.phoneFrom,
          TWILIOTO: config.twilio.phoneTo,
          TWILIOAID: config.twilio.accountId,
          TWILIOAUTH: config.twilio.authCode,
          DISCORDWEBHOOKS: config.discord.webhookUrls,
          STARTUPMIN: config.startupMinutes,
          SHUTDOWNMIN: config.shutdownMinutes,
          RCON_PORT: `${palwordServerConfig.rcon.port}`,
          RCON_PASSWORD: palwordServerConfig.rcon.password,
        },
        logging: config.debug
          ? new ecs.AwsLogDriver({
              logRetention: logs.RetentionDays.THREE_DAYS,
              streamPrefix: constants.WATCHDOG_SERVER_CONTAINER_NAME,
            })
          : undefined,
      }
    );

    const serviceControlPolicy = new iam.Policy(this, 'ServiceControlPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowAllOnServiceAndTask',
          effect: iam.Effect.ALLOW,
          actions: ['ecs:*'],
          resources: [
            palworldServerService.serviceArn,
            /* arn:aws:ecs:<region>:<account_number>:task/palworld/* */
            Arn.format(
              {
                service: 'ecs',
                resource: 'task',
                resourceName: `${constants.CLUSTER_NAME}/*`,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              },
              this
            ),
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:DescribeNetworkInterfaces'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ssmmessages:CreateControlChannel',
            'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel',
            'ssmmessages:OpenDataChannel',
          ],
          resources: ['*'],
        }),
      ],
    });

    serviceControlPolicy.attachToRole(ecsTaskRole);

    /**
     * Add service control policy to the launcher lambda from the other stack
     */
    const launcherLambdaRoleArn = new SSMParameterReader(
      this,
      'launcherLambdaRoleArn',
      {
        parameterName: constants.LAUNCHER_LAMBDA_ARN_SSM_PARAMETER,
        region: constants.DOMAIN_STACK_REGION,
      }
    ).getParameterValue();
    const launcherLambdaRole = iam.Role.fromRoleArn(
      this,
      'LauncherLambdaRole',
      launcherLambdaRoleArn
    );
    serviceControlPolicy.attachToRole(launcherLambdaRole);

    /**
     * This policy gives permission to our ECS task to update the A record
     * associated with our palworld server. Retrieve the hosted zone identifier
     * from Route 53 and place it in the Resource line within this policy.
     */
    const iamRoute53Policy = new iam.Policy(this, 'IamRoute53Policy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowEditRecordSets',
          effect: iam.Effect.ALLOW,
          actions: [
            'route53:GetHostedZone',
            'route53:ChangeResourceRecordSets',
            'route53:ListResourceRecordSets',
          ],
          resources: [`arn:aws:route53:::hostedzone/${hostedZoneId}`],
        }),
      ],
    });
    iamRoute53Policy.attachToRole(ecsTaskRole);

    // Create a new EC2 template for the on-demand EFS maintenance instances
    const efsMaintenanceInstanceRole = new iam.Role(
      this,
      'EFSMaintenanceRole',
      {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        description: 'Palworld EC2 instance role',
      }
    );
    efsReadWriteDataPolicy.attachToRole(efsMaintenanceInstanceRole);

    const efsMaintenanceSecurityGroup = new ec2.SecurityGroup(
      this,
      'EfsMaintenanceSecurityGroup',
      {
        vpc,
        description:
          'Security group for Palworld on-demand EFS Maintenance Instances',
      }
    );

    efsMaintenanceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22)
    );

    /* Allow access to EFS from Fargate service security group */
    fileSystem.connections.allowDefaultPortFrom(efsMaintenanceSecurityGroup);

    const efsMaintenanceLaunchTemplate = new ec2.LaunchTemplate(
      this,
      'EFSMaintenanceLaunchTemplate',
      {
        userData: ec2.UserData.custom(`#cloud-config
package_update: true
package_upgrade: true
runcmd:
- yum install -y amazon-efs-utils
- apt-get -y install amazon-efs-utils
- yum install -y nfs-utils
- apt-get -y install nfs-common
- file_system_id_1=${fileSystem.fileSystemId}
- efs_mount_point_1=/mnt/efs/fs1
- mkdir -p "\${efs_mount_point_1}"
- test -f "/sbin/mount.efs" && printf "\\n\${file_system_id_1}:/ \${efs_mount_point_1} efs iam,tls,_netdev\\n" >> /etc/fstab || printf "\\n\${file_system_id_1}.efs.${config.serverRegion}.amazonaws.com:/ \${efs_mount_point_1} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0\\n" >> /etc/fstab
- test -f "/sbin/mount.efs" && grep -ozP 'client-info]\\nsource' '/etc/amazon/efs/efs-utils.conf'; if [[ $? == 1 ]]; then printf "\\n[client-info]\\nsource=liw\\n" >> /etc/amazon/efs/efs-utils.conf; fi;
- retryCnt=15; waitTime=30; while true; do mount -a -t efs,nfs4 defaults; if [ $? = 0 ] || [ $retryCnt -lt 1 ]; then echo File system mounted successfully; break; fi; echo File system not available, retrying to mount.; ((retryCnt--)); sleep $waitTime; done;
`),
        role: efsMaintenanceInstanceRole,
        spotOptions: {
          interruptionBehavior: ec2.SpotInstanceInterruption.TERMINATE,
          requestType: ec2.SpotRequestType.ONE_TIME,
        },
        securityGroup: efsMaintenanceSecurityGroup,
        instanceInitiatedShutdownBehavior:
          ec2.InstanceInitiatedShutdownBehavior.TERMINATE,
      }
    );
  }
}
