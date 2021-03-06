import {ABQueue, NextIter} from "./queue"
import {AESKey, PublicKey, PrivateKey, KeyType, PrivateType} from "./crypto"
import * as C from "./crypto"
import * as B from "./buffer"
import {SMPCommand, Party, Client, SMPError, CMDErrorType, smpCommandP, smpCmdError, serializeSMPCommand} from "./protocol"
import {Parser} from "./parser"

export class TransportError extends Error {}

export abstract class Transport<W, R> {
  readonly queue: ABQueue<R>

  protected constructor(qSize: number) {
    this.queue = new ABQueue(qSize)
  }

  [Symbol.asyncIterator](): Transport<W, R> {
    return this
  }

  abstract close(): Promise<void>

  abstract write(bytes: W): Promise<void>

  async read(): Promise<R> {
    return this.queue.dequeue()
  }

  async next(): Promise<NextIter<R>> {
    return this.queue.next()
  }
}

type WSData = Uint8Array | string

export class WSTransport extends Transport<WSData, WSData> {
  private constructor(private readonly sock: WebSocket, readonly timeout: number, qSize: number) {
    super(qSize)
  }

  static connect(url: string, timeout: number, qSize: number): Promise<WSTransport> {
    const sock = new WebSocket(url)
    const t = new WSTransport(sock, timeout, qSize)
    sock.onmessage = async ({data}: MessageEvent) => await t.queue.enqueue(data)
    sock.onclose = async () => await t.queue.close()
    sock.onerror = () => sock.close()
    return withTimeout(timeout, () => new Promise((r) => (sock.onopen = () => r(t))))
  }

  close(): Promise<void> {
    this.sock.close()
    return Promise.resolve()
  }

  write(data: WSData): Promise<void> {
    const buffered = this.sock.bufferedAmount
    this.sock.send(data)
    return withTimeout(this.timeout, async () => {
      while (this.sock.bufferedAmount > buffered) await delay()
    })
  }

  async readBinary(size: number): Promise<Uint8Array> {
    const data = await this.read()
    if (typeof data == "string") throw new TransportError("invalid text block: expected binary")
    if (data.byteLength !== size) throw new TransportError("invalid block size")
    return data
  }
}

function withTimeout<T>(ms: number, action: () => Promise<T>): Promise<T> {
  return Promise.race([
    action(),
    (async () => {
      await delay(ms)
      throw new Error("timeout")
    })(),
  ])
}

export interface SMPServer {
  readonly host: string
  readonly port?: string
  readonly keyHash?: Uint8Array
}

interface Transmission<P extends Party> {
  readonly corrId: Uint8Array
  readonly queueId: Uint8Array
  readonly command?: SMPCommand<P>
}

export interface ClientTransmission extends Required<Transmission<Client>> {
  readonly key?: PrivateKey<PrivateType.Sign>
}

export type BrokerTransmission =
  | Required<Transmission<Party.Broker>>
  | (Transmission<Party.Broker> & {
      readonly error: SMPError
    })

const badBlock: BrokerTransmission = {
  corrId: B.empty,
  queueId: B.empty,
  error: {eType: "BLOCK"},
}

export class SMPTransport extends Transport<ClientTransmission, BrokerTransmission> {
  readonly blockSize: number

  private constructor(private readonly th: THandle, readonly timeout: number, qSize: number) {
    super(qSize)
    this.blockSize = th.blockSize
  }

  static async connect(srv: SMPServer, timeout: number, qSize: number): Promise<SMPTransport> {
    const conn = await WSTransport.connect(`ws://${srv.host}:${srv.port || "80"}`, timeout, qSize)
    const th = await clientHandshake(conn, srv.keyHash)
    const t = new SMPTransport(th, timeout, qSize)
    processWSQueue(t, th).then(noop, noop)
    return t
  }

  async close(): Promise<void> {
    await this.th.conn.close()
  }

  async write(t: ClientTransmission): Promise<void> {
    const trn = serializeTransmission(t)
    const sig = t.key ? new Uint8Array(await C.sign(t.key, trn)) : undefined
    const data = B.unwordsN(sig ? B.encodeBase64(sig) : B.empty, trn, B.empty)
    return tPutEncrypted(this.th, data)
  }
}

export function noop(): void {}

async function processWSQueue(t: SMPTransport, th: THandle): Promise<void> {
  for await (const data of th.conn) {
    const block = data instanceof Promise ? await data : data
    if (typeof block == "string" || block.byteLength !== th.blockSize) {
      await t.queue.enqueue(badBlock)
      continue
    }
    const s = new Uint8Array(await decryptBlock(th.rcvKey, block))
    await t.queue.enqueue(parseSMPTransmission(s))
  }
  await t.queue.close()
}

function parseSMPTransmission(s: Uint8Array): BrokerTransmission {
  const p = new Parser(s)
  let corrId: Uint8Array | undefined
  let queueId: Uint8Array | undefined
  let command: SMPCommand | undefined
  let qErr: CMDErrorType | undefined
  return p.space() && ((corrId = p.word()), p.space()) && ((queueId = p.try(() => p.base64()) || B.empty), p.space())
    ? // eslint-disable-next-line no-cond-assign
      (command = smpCommandP(p))
      ? command.party === Party.Broker
        ? // eslint-disable-next-line no-cond-assign
          (qErr = tQueueError(queueId, command))
          ? {corrId, queueId, error: smpCmdError(qErr)}
          : {corrId, queueId, command}
        : {corrId, queueId, error: smpCmdError("PROHIBITED")}
      : {corrId, queueId, error: smpCmdError("SYNTAX")}
    : badBlock
}

function tQueueError(queueId: Uint8Array, {cmd}: SMPCommand<Party.Broker>): CMDErrorType | undefined {
  switch (cmd) {
    case "IDS":
    case "PONG":
      return queueId.length > 0 ? "HAS_AUTH" : undefined
    case "ERR":
      return
    default:
      return queueId.length === 0 ? "NO_QUEUE" : undefined
  }
}

function serializeTransmission({corrId, queueId, command}: ClientTransmission): Uint8Array {
  return B.unwordsN(corrId, B.encodeBase64(queueId), serializeSMPCommand(command))
}

function delay(ms?: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function tPutEncrypted({conn, sndKey, blockSize}: THandle, data: ArrayBuffer): Promise<void> {
  const iv = nextIV(sndKey)
  const block = await C.encryptAES(sndKey.aesKey, iv, blockSize - C.authTagSize, data)
  return conn.write(new Uint8Array(block))
}

export async function tGetEncrypted({conn, rcvKey, blockSize}: THandle): Promise<ArrayBuffer> {
  return decryptBlock(rcvKey, await conn.readBinary(blockSize))
}

async function decryptBlock(k: SessionKey, block: Uint8Array): Promise<ArrayBuffer> {
  const iv = nextIV(k)
  return C.decryptAES(k.aesKey, iv, block)
}

function nextIV(k: SessionKey): ArrayBuffer {
  const c = B.encodeInt32(k.counter++)
  const start = k.baseIV.slice(0, 4)
  const rest = k.baseIV.slice(4)
  start.forEach((b, i) => (start[i] = b ^ c[i]))
  return B.concat(start, rest)
}

export interface THandle {
  readonly conn: WSTransport
  readonly sndKey: SessionKey
  readonly rcvKey: SessionKey
  readonly blockSize: number
}

interface SessionKey {
  readonly aesKey: AESKey
  readonly baseIV: Uint8Array
  counter: number
}

async function serializeSessionKey(k: SessionKey): Promise<Uint8Array> {
  return B.concat(new Uint8Array(await C.encodeAESKey(k.aesKey)), k.baseIV)
}

interface ServerHeader {
  readonly blockSize: number
  readonly keySize: number
}

function parseServerHeader(a: Uint8Array): ServerHeader {
  if (a.byteLength !== 8) throw new TransportError(`transport handshake error: bad header size ${a.byteLength}`)
  const v = new DataView(buffer(a))
  const blockSize = v.getUint32(0)
  const transportMode = v.getUint16(4)
  if (transportMode !== binaryRsaTransport) {
    throw new TransportError(`transport handshake error: bad transport mode ${transportMode}`)
  }
  const keySize = v.getUint16(6)
  return {blockSize, keySize}
}

interface ServerHandshake {
  readonly serverKey: PublicKey<KeyType.Encrypt>
  readonly blockSize: number
}

interface ClientHandshake {
  readonly blockSize: number
  readonly sndKey: SessionKey
  readonly rcvKey: SessionKey
}

async function serializeClientHandshake(h: ClientHandshake): Promise<Uint8Array> {
  return B.concatN(
    B.encodeInt32(h.blockSize),
    B.encodeInt16(binaryRsaTransport),
    await serializeSessionKey(h.sndKey),
    await serializeSessionKey(h.rcvKey)
  )
}

type SMPVersion = readonly [number, number, number, number]

function parseSMPVersion(block: ArrayBuffer): SMPVersion {
  // TODO better parsing
  const a = new Uint8Array(block)
  let i = 0
  while (i < 50 && i < a.length && a[i] !== B.space) i++
  const version = B.decodeAscii(a.subarray(0, i))
    .split(".")
    .map((n) => +n)
  if (version.length === 4 && version.every((n) => !Number.isNaN(n))) return version as unknown as SMPVersion
  throw new Error("transport handshake error: cannot parse version")
}

const currentSMPVersion: SMPVersion = [0, 4, 1, 0]

const serverHeaderSize = 8

const binaryRsaTransport = 0

const transportBlockSize = 4096

const maxTransportBlockSize = 65536

// Client SMP encrypted transport handshake.
// See https://github.com/simplex-chat/simplexmq/blob/master/protocol/simplex-messaging.md#appendix-a
// The numbers in function names refer to the steps in the document.
export async function clientHandshake(conn: WSTransport, keyHash?: Uint8Array): Promise<THandle> {
  const {serverKey, blockSize} = await getHeaderAndPublicKey_1_2(conn, keyHash)
  const keys: ClientHandshake = await getClientHandshake_3(blockSize)
  await sendEncryptedKeys_4(conn, serverKey, keys)
  const th: THandle = {conn, ...keys}
  checkVersion(await getWelcome_6(th))
  return th
}

async function getHeaderAndPublicKey_1_2(c: WSTransport, keyHash?: Uint8Array): Promise<ServerHandshake> {
  const header = await c.readBinary(serverHeaderSize)
  const {blockSize, keySize} = parseServerHeader(header)
  if (blockSize < transportBlockSize || blockSize > maxTransportBlockSize) {
    throw new TransportError(`transport handshake header error: bad block size ${blockSize}`)
  }
  const rawKey = await c.readBinary(keySize)
  if (keyHash !== undefined) await validateKeyHash_2(rawKey, keyHash)
  const serverKey = await C.decodePublicKey(rawKey, KeyType.Encrypt)
  return {serverKey, blockSize}
}

async function validateKeyHash_2(rawKey: ArrayBuffer, keyHash: Uint8Array): Promise<void> {
  const hash = await C.sha256(rawKey)
  if (keyHash.byteLength === 32 && hash.byteLength === 32) {
    const h = new Uint8Array(hash)
    if (keyHash.every((n, i) => n === h[i])) return
  }
  throw new TransportError(`transport handshake error: key hash does not match`)
}

async function getClientHandshake_3(blockSize: number): Promise<ClientHandshake> {
  return {
    blockSize,
    sndKey: await sessionKey(),
    rcvKey: await sessionKey(),
  }
}

async function sessionKey(): Promise<SessionKey> {
  return {
    aesKey: await C.randomAESKey(),
    baseIV: new Uint8Array(C.randomIV()),
    counter: 0,
  }
}

async function sendEncryptedKeys_4(c: WSTransport, key: PublicKey<KeyType.Encrypt>, clientKeys: ClientHandshake): Promise<void> {
  return c.write(new Uint8Array(await C.encryptOAEP(key, await serializeClientHandshake(clientKeys))))
}

async function getWelcome_6(th: THandle): Promise<SMPVersion> {
  return parseSMPVersion(await tGetEncrypted(th))
}

function checkVersion([s1, s2]: SMPVersion): void {
  const [c1, c2] = currentSMPVersion
  if (s1 > c1 || (s1 === c1 && s2 > c2)) throw new TransportError("transport handshake error: incompatible server version")
}

function buffer(a: Uint8Array): ArrayBuffer {
  if (a.byteOffset === 0 && a.byteLength === a.buffer.byteLength) return a.buffer
  return a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)
}
