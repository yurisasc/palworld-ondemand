import { AWSProfile, PalworldServer } from "../models/internal-models";
import { AWSService } from "./aws-service";
import { RconService } from "./rcon-service";

export class MultiServersService {
  private servers: PalworldServer[];

  constructor(
    private readonly awsService: AWSService,
    private readonly rconService: RconService
  ) {
    this.servers = readServerConfigs();
  }

  public async startServerByName(name: string): Promise<void> {
    const awsAccount = this.awsAccountByName(name);
    await this.awsService.startServer(awsAccount);
  }

  public async stopServerByName(name: string): Promise<void> {
    const awsAccount = this.awsAccountByName(name);
    await this.awsService.stopServer(awsAccount);
  }

  public async saveGameAndShutdownByName(name: string): Promise<void> {
    const awsAccount = this.awsAccountByName(name);
    const publicIp = await this.awsService.getServerPublicIP(awsAccount);

    try {
      this.rconService.connect({
        host: publicIp,
        port: 25575,
        password: process.env.RCON_PASSWORD!,
      });
      console.log("Authenticated");

      const saveResult = await this.rconService.sendCommand("Save");

      // Delay to allow the server to save
      await new Promise((resolve) => setTimeout(resolve, 15000));
      console.log("SaveResult:", saveResult);

      const shutdownResult = await this.rconService.sendCommand(
        "Shutdown 10 Shutdown executed by Discord bot..."
      );

      console.log("ShutdownResult:", shutdownResult);
      // Delay to allow the server to shutdown
      await new Promise((resolve) => setTimeout(resolve, 15000));
    } catch (error) {
      console.error("Error in saveGameAndShutdownByName:", error);
    }
  }

  private awsAccountByName(name: string): AWSProfile {
    const awsAccount = this.servers.find(
      (server) => server.name === name
    )?.awsAccount;

    if (!awsAccount) throw Error(`Server ${name} not configured correctly`);
    return awsAccount;
  }
}

export function readServerConfigs(): PalworldServer[] {
  return JSON.parse(process.env.SERVERS_CONFIG ?? "[]");
}

export function getServerNames(): string[] {
  return readServerConfigs().map((server) => server.name);
}
