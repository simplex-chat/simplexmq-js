import * as SMP from "./protocol"
import {SMPCommand, SMPError, Party, Client} from "./protocol"
import {ABQueue} from "./queue"
import {SMPTransport, SMPServer, ClientTransmission, noop} from "./transport"
import {SignKey, PublicKey, KeyType} from "./crypto"
import * as B from "./buffer"
import * as C from "./crypto"

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
    readonly server: SMPServer,
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

  sendSMPCommand(key: SignKey | undefined, queueId: Uint8Array, command: SMPCommand<Client>): Promise<BrokerResponse> {
    const corrId = `${this.clientCorrId++}`
    const t: ClientTransmission = {key, corrId: B.encodeAscii(corrId), queueId, command}
    this.transport.write(t).then(noop, noop)
    return new Promise((resolve, reject) => this.sentCommands.set(corrId, {queueId, resolve, reject}))
  }

  async disconnect(): Promise<void> {
    await this.transport.close()
    await this.client
  }

  async createSMPQueue(rcvKey: SignKey, rcvPubKey: PublicKey<KeyType.Verify>): Promise<SMP.IDS> {
    const pubKeyStr = new Uint8Array(await C.encodePubKey(rcvPubKey))
    const resp = await this.sendSMPCommand(rcvKey, B.empty, SMP.cNEW(pubKeyStr))
    if (resp.cmd === "IDS") return resp
    throw new Error("unexpected response")
  }

  subscribeSMPQueue(rcvKey: SignKey, queueId: Uint8Array): Promise<void> {
    return this.msgSMPCommand(rcvKey, queueId, SMP.cSUB())
  }

  async secureSMPQueue(rcvKey: SignKey, queueId: Uint8Array, sndPubKey: PublicKey<KeyType.Verify>): Promise<void> {
    const pubKeyStr = new Uint8Array(await C.encodePubKey(sndPubKey))
    return this.okSMPCommand(rcvKey, queueId, SMP.cKEY(pubKeyStr))
  }

  async sendSMPMessage(sndKey: SignKey | undefined, queueId: Uint8Array, msg: Uint8Array): Promise<void> {
    const resp = await this.sendSMPCommand(sndKey, queueId, SMP.cSEND(msg))
    if (resp.cmd !== "OK") throw new Error("unexpected response")
  }

  ackSMPMessage(rcvKey: SignKey, queueId: Uint8Array): Promise<void> {
    return this.msgSMPCommand(rcvKey, queueId, SMP.cACK())
  }

  suspendSMPQueue(rcvKey: SignKey, queueId: Uint8Array): Promise<void> {
    return this.okSMPCommand(rcvKey, queueId, SMP.cOFF())
  }

  deleteSMPQueue(rcvKey: SignKey, queueId: Uint8Array): Promise<void> {
    return this.okSMPCommand(rcvKey, queueId, SMP.cDEL())
  }

  private async msgSMPCommand(rcvKey: SignKey, queueId: Uint8Array, command: SMPCommand<Client>): Promise<void> {
    const resp = await this.sendSMPCommand(rcvKey, queueId, command)
    switch (resp.cmd) {
      case "OK":
        return
      case "MSG":
        return this.msgQ.enqueue({server: this.server, queueId, command: resp})
      default:
        throw new Error("unexpected response")
    }
  }

  private async okSMPCommand(key: SignKey, queueId: Uint8Array, command: SMPCommand<Client>): Promise<void> {
    const resp = await this.sendSMPCommand(key, queueId, command)
    if (resp.cmd !== "OK") throw new Error("unexpected response")
  }

  get connected(): boolean {
    return this._connected
  }
}
