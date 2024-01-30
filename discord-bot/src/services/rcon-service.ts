import * as net from "net";

export class RconService {
  private client: net.Socket;
  private requestId: number = 1;
  private host: string;
  private port: number;
  private password: string;

  connect({
    host,
    port,
    password,
  }: {
    host: string;
    port: number;
    password: string;
  }): Promise<void> {
    this.host = host;
    this.port = port;
    this.password = password;
    this.client = new net.Socket();

    return new Promise((resolve, reject) => {
      this.client.connect(this.port, this.host, () => {
        this.sendPacket(3, this.password)
          .then(() => resolve())
          .catch(reject);
      });

      this.client.on("error", (error) => {
        reject(error);
      });
    });
  }

  sendCommand(command: string): Promise<string> {
    return this.sendPacket(2, command);
  }

  private sendPacket(type: number, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(14 + body.length);
      buffer.writeInt32LE(10 + body.length, 0);
      buffer.writeInt32LE(this.requestId, 4);
      buffer.writeInt32LE(type, 8);
      buffer.write(body, 12);
      buffer.writeInt16LE(0, 12 + body.length);

      this.client.write(buffer);

      this.client.once("data", (data) => {
        if (data.readInt32LE(8) === -1) {
          reject(new Error("Authentication failed"));
          return;
        }
        resolve(data.toString("utf-8", 12, data.length - 2));
      });

      this.client.once("error", (error) => {
        reject(error);
      });
    });
  }

  disconnect(): void {
    this.client.destroy();
  }
}
