import * as SMP from "./protocol"
import {SMPCommand, Party} from "./protocol"
import {ABQueue} from "./queue"
import {WSTransport, SMPServer, clientHandshake, THandle} from "./transport"
// import {PrivateKey, KeyType} from "./crypto"

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
  server: SMPServer
  rcvId: Uint8Array
  msg: SMP.MSG | SMP.END
}

interface Request {
  qId: Uint8Array
  resolve: (resp: SMPCommand<Party.Broker>) => void
  reject: (err: SMPClientError) => void
}

class SMPClientError extends Error {}

export class SMPClient {
  readonly blockSize: number
  private _connected = true
  // private clientCorrId = 0
  private readonly sentCommands = new Map<string, Request>()

  private constructor(
    readonly smpServer: SMPServer,
    readonly config: SMPClientConfig,
    readonly msgQ: ABQueue<ServerMessage>,
    readonly client: Promise<void>,
    private readonly th: THandle
  ) {
    this.blockSize = th.blockSize
  }

  // stub
  static async create(srv: SMPServer, cfg: SMPClientConfig, msgQ: ABQueue<ServerMessage>): Promise<SMPClient> {
    const th = await connectClient()
    const client = runClient(th)
    const c = new SMPClient(srv, cfg, msgQ, client, th)
    return c

    async function connectClient(): Promise<THandle> {
      const conn = await WSTransport.connect(`ws://${srv.host}:${srv.port || "80"}`, cfg.tcpTimeout, cfg.qSize)
      return clientHandshake(conn, srv.keyHash)
    }

    async function runClient(_th: THandle): Promise<void> {
      // for await(const block of th.conn) {

      // }
      await Promise.resolve()
      c._connected = false
    }
  }

  // async sendSMPCommand(
  //   key: PrivateKey<KeyType.Verify> | undefined,
  //   qId: Uint8Array,
  //   cmd: SMPCommand<Party.Recipient | Party.Sender>
  // ): Promise<SMPCommand<Party.Broker>> {
  //   const corrId = `${this.clientCorrId++}`
  //   let t = await signTransmission(serializeTransmission(corrId, qId, cmd))
  //   const p = new Promise<SMPCommand<Party.Broker>>((resolve, reject) => {
  //     this.sentCommands.set(corrId, {qId, resolve, reject})
  //   })
  //   await tPutEncrypted(this.th, t)
  //   return p
  // }

  get connected(): boolean {
    return this._connected
  }
}
