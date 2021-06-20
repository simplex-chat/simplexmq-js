import * as SMP from "./protocol"
import {SMPCommand, SMPError, Party, Client} from "./protocol"
import {ABQueue} from "./queue"
import {SMPTransport, SMPServer, ClientTransmission, noop} from "./transport"
import {PrivateKey, PrivateType} from "./crypto"
import * as B from "./buffer"

export interface SMPClientConfig {
  readonly qSize: number
  readonly tcpTimeout: number
  readonly smpPing: number
  readonly smpCommandSize: number
}

export const smpDefaultConfig: SMPClientConfig = {
  qSize: 16,
  tcpTimeout: 4000,
  smpPing: 30000,
  smpCommandSize: 256,
}

export interface ServerMessage {
  readonly server: SMPServer
  readonly queueId: Uint8Array
  readonly command: SMP.MSG | SMP.END
}

type BrokerResponse = Exclude<SMPCommand<Party.Broker>, SMP.ERR>

export interface Request {
  readonly queueId: Uint8Array
  readonly resolve: (resp: BrokerResponse) => void
  // TODO create SMPClientError type
  readonly reject: (err?: SMPError) => void
}

export class SMPClient {
  readonly blockSize: number
  private _connected = true
  private clientCorrId = 0
  private readonly sentCommands = new Map<string, Request>()

  private constructor(
    readonly smpServer: SMPServer,
    readonly config: SMPClientConfig,
    readonly msgQ: ABQueue<ServerMessage>,
    readonly client: Promise<void>,
    private readonly transport: SMPTransport
  ) {
    this.blockSize = transport.blockSize
  }

  static async create(server: SMPServer, cfg: SMPClientConfig, msgQ: ABQueue<ServerMessage>): Promise<SMPClient> {
    const transport = await SMPTransport.connect(server, cfg.tcpTimeout, cfg.qSize)
    const client = runClient().then(noop, noop)
    const c = new SMPClient(server, cfg, msgQ, client, transport)
    return c

    async function runClient(): Promise<void> {
      for await (const t of transport) {
        const resp = t instanceof Promise ? await t : t
        const {corrId, queueId, command} = resp
        const cId = B.decodeAscii(corrId)
        const req = c.sentCommands.get(cId)
        if (req) {
          c.sentCommands.delete(cId)
          if ("error" in resp) {
            req.reject(resp.error)
          } else if (command) {
            if (command.cmd === "ERR") req.reject(command.error)
            else req.resolve(command)
          } else {
            req.reject()
          }
        } else {
          // TODO send error to errQ
          if ("error" in resp || !command || !(command.cmd === "END" || command.cmd === "MSG")) continue
          await msgQ.enqueue({server, queueId, command})
        }
      }
      c._connected = false
    }
  }

  async sendSMPCommand(
    key: PrivateKey<PrivateType.Sign> | undefined,
    queueId: Uint8Array,
    command: SMPCommand<Client>
  ): Promise<BrokerResponse> {
    const corrId = `${this.clientCorrId++}`
    const t: ClientTransmission = {key, corrId: B.encodeAscii(corrId), queueId, command}
    const p = new Promise<BrokerResponse>((resolve, reject) => this.sentCommands.set(corrId, {queueId, resolve, reject}))
    await this.transport.write(t)
    return p
  }

  async disconnect(): Promise<void> {
    return this.transport.close()
  }

  get connected(): boolean {
    return this._connected
  }
}
