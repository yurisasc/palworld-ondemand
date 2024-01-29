import { Port } from 'aws-cdk-lib/aws-ec2';
import { Protocol } from 'aws-cdk-lib/aws-ecs';
import * as execa from 'execa';
import { constants } from './constants';
import { PalworldConfig, StackConfig } from './types';

export const stringAsBoolean = (str?: string): boolean =>
  Boolean(str === 'true');

export const stringAsNumberArray = (str?: string): number[] =>
  JSON.parse(str ?? '[]').map(Number) ?? [];

export const isDockerInstalled = (): boolean => {
  try {
    execa.sync('docker', ['version']);
    return true;
  } catch (e) {
    return false;
  }
};

export const getPalworldServerConfig = (rconPassword: string): PalworldConfig => {
  return {
    server: {
      image: constants.PALWORLD_DOCKER_IMAGE,
      port: 8211,
      protocol: Protocol.UDP,
      ingressRulePort: Port.udp(8211),
    },
    rcon: {
      image: constants.RCON_DOCKER_IMAGE,
      port: 25575,
      password: rconPassword,
      protocol: Protocol.TCP,
      ingressRulePort: Port.tcp(25575),
    },
  };
};
