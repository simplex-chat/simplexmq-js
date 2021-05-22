import * as SMP from "./protocol"
import {ABQueue} from "./queue"

export interface SMPServer {
  host: string
  port?: string
  keyHash: string
}

export interface SMPClientConfig {
  qSize: number
  tcpTimeout: number
  smpPing: number
  smpCommandSize: number
}

export const smpDefaultConfig: SMPClientConfig = {
  qSize: 16,
  tcpTimeout: 4000,
  smpPing: 30000,
  smpCommandSize: 256,
}

export interface ServerMessage {
  rcvId: string
  msg: SMP.MSG | SMP.END
}

export class SMPClient {
  private constructor(readonly server: SMPServer, readonly config: SMPClientConfig, readonly msgQ: ABQueue<ServerMessage>) {}

  // stub
  static create(server: SMPServer, config: SMPClientConfig): SMPClient {
    return new SMPClient(server, config, new ABQueue(config.qSize))
  }
}
