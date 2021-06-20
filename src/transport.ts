/* eslint-disable no-console */
import {ABQueue, NextIter} from "./queue"
import {AESKey, PublicKey, KeyType} from "./crypto"
import * as C from "./crypto"
import {concat, concatN, encodeInt32, encodeInt16, decodeAscii, space, unwordsN, encodeBase64, empty} from "./buffer"
import {SMPCommand, Party, SMPError, smpCommandP, smpError} from "./protocol"
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

  async close(): Promise<void> {
    this.sock.close()
    for await (const x of this.queue) if (x instanceof Promise) await x
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
  readonly keyHash: Uint8Array
}

interface SignedRawTransmission {
  readonly signature: Uint8Array
  readonly transmission: Uint8Array
}

interface TransmissionOrError {
  readonly signature: Uint8Array
  readonly corrId: Uint8Array
  readonly queueId: Uint8Array
  readonly command?: SMPCommand<Party.Broker>
  readonly error?: SMPError
}

const badBlock: TransmissionOrError = {
  signature: empty,
  corrId: empty,
  queueId: empty,
  error: {eType: "BLOCK"},
}

export class SMPTransport extends Transport<SignedRawTransmission, TransmissionOrError> {
  private constructor(private readonly th: THandle, readonly timeout: number, qSize: number) {
    super(qSize)
  }

  static async connect(srv: SMPServer, timeout: number, qSize: number): Promise<SMPTransport> {
    const conn = await WSTransport.connect(`ws://${srv.host}:${srv.port || "80"}`, timeout, qSize)
    const th = await clientHandshake(conn, srv.keyHash)
    const t = new SMPTransport(th, timeout, qSize)
    const close: () => Promise<void> = () => t.close()
    processWSQueue(t, th).then(close, close)
    return t
  }

  close(): Promise<void> {
    return this.th.conn.close()
  }

  async write({signature, transmission}: SignedRawTransmission): Promise<void> {
    const data = unwordsN(encodeBase64(signature), transmission, empty)
    return tPutEncrypted(this.th, data)
  }
}

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
}

function parseSMPTransmission(s: Uint8Array): TransmissionOrError {
  const p = new Parser(s)
  let signature: Uint8Array | undefined
  let corrId: Uint8Array | undefined
  let queueId: Uint8Array | undefined
  let command: SMPCommand | undefined
  return (signature = p.base64()) && p.space() && ((corrId = p.word()), p.space()) && (queueId = p.base64()) && p.space()
    ? // eslint-disable-next-line no-cond-assign
      (command = smpCommandP(p))
      ? command.party === Party.Broker
        ? {signature, corrId, queueId, command}
        : {signature, corrId, queueId, error: smpError("CMD", "PROHIBITED")}
      : {signature, corrId, queueId, error: smpError("CMD", "SYNTAX")}
    : badBlock
}

function delay(ms?: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function tPutEncrypted({conn, sndKey, blockSize}: THandle, data: ArrayBuffer): Promise<void> {
  const iv = nextIV(sndKey)
  const {encrypted, authTag} = await C.encryptAESData(sndKey.aesKey, iv, blockSize - C.authTagSize, data)
  return conn.write(concat(authTag, encrypted))
}

// TODO change server in v0.4 to match (auth tag should be appended to the end)
export async function tPutEncrypted1({conn, sndKey, blockSize}: THandle, data: ArrayBuffer): Promise<void> {
  const iv = nextIV(sndKey)
  const block = await C.encryptAES(sndKey.aesKey, iv, blockSize - C.authTagSize, data)
  return conn.write(new Uint8Array(block))
}

export async function tGetEncrypted({conn, rcvKey, blockSize}: THandle): Promise<ArrayBuffer> {
  return decryptBlock(rcvKey, await conn.readBinary(blockSize))
}

async function decryptBlock(k: SessionKey, block: Uint8Array): Promise<ArrayBuffer> {
  const authTag = block.subarray(0, 16)
  const encrypted = block.subarray(16)
  const iv = nextIV(k)
  return C.decryptAESData(k.aesKey, iv, {encrypted, authTag})
}

// TODO change server in v0.4 to match (auth tag should be appended to the end)
export async function tGetEncrypted1({conn, rcvKey, blockSize}: THandle): Promise<ArrayBuffer> {
  const block = await conn.readBinary(blockSize)
  const iv = nextIV(rcvKey)
  return C.decryptAES(rcvKey.aesKey, iv, block)
}

function nextIV(k: SessionKey): ArrayBuffer {
  const c = encodeInt32(k.counter++)
  const start = k.baseIV.slice(0, 4)
  const rest = k.baseIV.slice(4)
  start.forEach((b, i) => (start[i] = b ^ c[i]))
  return concat(start, rest)
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
  return concat(new Uint8Array(await C.encodeAESKey(k.aesKey)), k.baseIV)
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
  return concatN(
    encodeInt32(h.blockSize),
    encodeInt16(binaryRsaTransport),
    await serializeSessionKey(h.sndKey),
    await serializeSessionKey(h.rcvKey)
  )
}

type SMPVersion = readonly [number, number, number, number]

function parseSMPVersion(block: ArrayBuffer): SMPVersion {
  // TODO better parsing
  const a = new Uint8Array(block)
  let i = 0
  while (i < 50 && i < a.length && a[i] !== space) i++
  const version = decodeAscii(a.subarray(0, i))
    .split(".")
    .map((n) => +n)
  if (version.length === 4 && version.every((n) => !Number.isNaN(n))) return version as unknown as SMPVersion
  throw new Error("transport handshake error: cannot parse version")
}

const currentSMPVersion: SMPVersion = [0, 3, 2, 0]

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
