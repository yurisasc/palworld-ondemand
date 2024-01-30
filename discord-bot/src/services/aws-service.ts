import AWS from "aws-sdk";
import { AWSProfile } from "../models/internal-models";

export class AWSService {
  public async startServer(profile: AWSProfile): Promise<void> {
    this.setProfile(profile);
    this.setServiceDesiredCount(1);
  }

  public async stopServer(profile: AWSProfile): Promise<void> {
    this.setProfile(profile);
    this.setServiceDesiredCount(0);
  }

  public async getServerPublicIP(profile: AWSProfile): Promise<string> {
    this.setProfile(profile);
    try {
      const service = new AWS.ECS({ region: profile.region });
      const network = new AWS.EC2({ region: profile.region });

      const tasks = await service
        .listTasks({
          cluster: process.env.CLUSTER_NAME,
          serviceName: process.env.SERVICE_NAME,
        })
        .promise();

      if (tasks.taskArns.length === 0) {
        console.log("No tasks found for this service");
        return;
      }

      const describeTasksResponse = await service
        .describeTasks({
          cluster: process.env.CLUSTER_NAME,
          tasks: tasks.taskArns,
        })
        .promise();
      const task = describeTasksResponse.tasks[0];
      const eni = task.attachments[0].details.find(
        (detail) => detail.name === "networkInterfaceId"
      ).value;

      // Get the public IP address from the network interface
      const networkInterface = await network
        .describeNetworkInterfaces({
          NetworkInterfaceIds: [eni],
        })
        .promise();
      return networkInterface.NetworkInterfaces[0].Association.PublicIp;
    } catch (error) {
      console.error("Error finding public IP:", error);
    }
  }

  private setServiceDesiredCount(desiredCount: number): void {
    const ecs = new AWS.ECS();

    const params = {
      cluster: process.env.CLUSTER_NAME,
      service: process.env.SERVICE_NAME,
      desiredCount: desiredCount,
    };

    ecs.updateService(params, (err, data) => {
      if (err) {
        console.log(`Error updating service: ${err}`);
      } else {
        console.log(`Service updated: ${data}`);
      }
    });
  }

  private setProfile(profile: AWSProfile) {
    const credentials = new AWS.Credentials({
      accessKeyId: profile.accessKeyId,
      secretAccessKey: profile.secretAccessKey,
    });

    const config = new AWS.Config({
      credentials: credentials,
      region: profile.region,
    });

    AWS.config.update(config);
  }
}
