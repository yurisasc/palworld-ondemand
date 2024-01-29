import type { Protocol } from 'aws-cdk-lib/aws-ecs';
import type { Port } from 'aws-cdk-lib/aws-ec2';

interface TwilioConfig {
  /**
   * Your twilio phone number.
   *
   * @example
   * `+1XXXYYYZZZZ`
   */
  phoneFrom: string;
  /**
   * Phone number to receive text notifications at.
   *
   * @example
   * `+1XXXYYYZZZZ`
   */
  phoneTo: string;
  /**
   * Twilio account ID
   */
  accountId: string;
  /**
   * Twilio auth code
   */
  authCode: string;
}

interface DiscordConfig {
  /**
   * Discord webhook URLs, comma separated.
   *
   * @example
   * `https://discord.com/api/webhooks/1234567890/abcdefghijklmnopqrstuvwxyz`
   */
  webhookUrls: string;
}

export type PalworldImageEnv = Record<string, string>;

export interface StackConfig {
  /**
   * **Required**. Domain name of existing Route53 Hosted Zone
   *
   */
  domainName: string;
  /**
   * Name of the subdomain part to be used for creating a delegated hosted zone
   * (palworld.example.com) and an NS record on your existing (example.com)
   * hosted zone. This subdomain should not already be in use.
   *
   * @default "palworld"
   */
  subdomainPart: string;
  /**
   * The AWS region to deploy your palworld server in.
   *
   * @default "us-east-1"
   */
  serverRegion: string;
  /**
   * Number of minutes to wait for a connection after starting before terminating (optional, default 10)
   *
   * @default "10"
   */
  startupMinutes: string;
  /**
   * Number of minutes to wait after the last client disconnects before terminating (optional, default 20)
   *
   * @default "20"
   */
  shutdownMinutes: string;
  /**
   * Sets the preference for Fargate Spot.
   *
   * If you leave it 'false', your tasks will launch under the FARGATE strategy
   * which currently will run about 5 cents per hour. You can switch it to true
   * to enable FARGATE_SPOT, and pay 1.5 cents per hour. While this is cheaper,
   * technically AWS can terminate your instance at any time if they need the
   * capacity. The watchdog is designed to intercept this termination command
   * and shut down safely, so it's fine to use Spot to save a few pennies, at
   * the extremely low risk of game interruption.
   *
   * @default false
   */
  useFargateSpot: boolean;
  /**
   * The number of cpu units used by the task running the Palworld server.
   *
   * Valid values, which determines your range of valid values for the memory parameter:
   *
   * 256 (.25 vCPU) - Available memory values: 0.5GB, 1GB, 2GB
   *
   * 512 (.5 vCPU) - Available memory values: 1GB, 2GB, 3GB, 4GB
   *
   * 1024 (1 vCPU) - Available memory values: 2GB, 3GB, 4GB, 5GB, 6GB, 7GB, 8GB
   *
   * 2048 (2 vCPU) - Available memory values: Between 4GB and 16GB in 1GB increments
   *
   * 4096 (4 vCPU) - Available memory values: Between 8GB and 30GB in 1GB increments
   *
   * @default 1024 1 vCPU
   */
  taskCpu: number;
  /**
   * The amount (in MiB) of memory used by the task running the Palworld server.
   *
   * 512 (0.5 GB), 1024 (1 GB), 2048 (2 GB) - Available cpu values: 256 (.25 vCPU)
   *
   * 1024 (1 GB), 2048 (2 GB), 3072 (3 GB), 4096 (4 GB) - Available cpu values: 512 (.5 vCPU)
   *
   * 2048 (2 GB), 3072 (3 GB), 4096 (4 GB), 5120 (5 GB), 6144 (6 GB), 7168 (7 GB), 8192 (8 GB) - Available cpu values: 1024 (1 vCPU)
   *
   * Between 4096 (4 GB) and 16384 (16 GB) in increments of 1024 (1 GB) - Available cpu values: 2048 (2 vCPU)
   *
   * Between 8192 (8 GB) and 30720 (30 GB) in increments of 1024 (1 GB) - Available cpu values: 4096 (4 vCPU)
   *
   * @default 2048 2 GB
   */
  taskMemory: number;
  /**
   * The ID of an already existing VPC to deploy the server to. When this valueis not set, a new VPC is automatically created by default.
   */
  vpcId: string;
  /**
   * The password for the RCON commands. This is required for the server to start.
   */
  rconPassword: string;
  /**
   * The email address you would like to receive notifications at.
   *
   * If this value is specified, an SNS topic is created and you will receive
   * email notifications each time the palworld server is launched and ready.
   */
  snsEmailAddress: string;
  twilio: TwilioConfig;
  discord: DiscordConfig;
  /**
   * Additional environment variables to be passed to the
   * [Palworld Docker Server](https://github.com/jammsen/docker-palworld-dedicated-server)
   */
  palworldImageEnv: PalworldImageEnv;
  /**
   * Setting to `true` enables debug mode.
   *
   * This will enable the following:
   * - CloudWatch Logs for the `palworld-server` ECS Container
   * - CloudWatch Logs for the `palworld-ecsfargate-watchdog` ECS Container
   */
  debug: boolean;
  /**
   * Extra TCP ports to open on the security group
   *
   * @default []
   * @example [25565, 25575]
   */
  extraTcpPorts: number[];
  /**
   * Extra UDP ports to open on the security group
   *
   * @default []
   * @example [19132]
   */
  extraUdpPorts: number[];
}

export interface PalworldConfig {
  server: {
    /**
     * Name of the docker image to pull for the Palworld server
     *
     * @example 'jammsen/palworld-dedicated-server'
     */
    image: string;
    /**
     * Port number to run the Palworld server on
     */
    port: number;
    /**
     * Protocol for the Palworld server
     */
    protocol: Protocol;
    /**
     * The ingress rule port to be used for the service security group
     */
    ingressRulePort: Port;
  };
  rcon: {
    /**
     * Name of the docker image to pull for the RCON commands
     * @example 'outdead/rcon'
     */
    image: string;
    /**
     * Port number for the RCON commands
     */
    port: number;
    /**
     * Password for the RCON commands
     */
    password: string;
    /**
     * Protocol for the RCON commands
     */
    protocol: Protocol;
    /**
     * The ingress rule port to be used for the service security group
     */
    ingressRulePort: Port;
  };
}
