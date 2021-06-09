/* eslint-disable no-console */
import {ABQueue} from "./queue"
import {
  AESKey,
  PublicKey,
  KeyType,
  decodePublicKey,
  sha256,
  randomAESKey,
  encodeAESKey,
  encryptOAEP,
  randomIV,
  concat,
  concatN,
  encodeInt32,
  encodeInt16,
  encryptAES,
  decryptAES,
  decryptAESData,
  authTagSize,
} from "./crypto"

export class TransportError extends Error {}

export abstract class Transport {
  readonly queue: ABQueue<Uint8Array>

  protected constructor(qSize: number) {
    this.queue = new ABQueue(qSize)
  }

  abstract close(): Promise<void>

  abstract write(bytes: Uint8Array): Promise<void>

  async read(size: number): Promise<Uint8Array> {
    const data = await this.queue.dequeue()
    if (data.byteLength === size) return data
    throw new TransportError("invalid block size")
  }
}

export class WS extends Transport {
  private constructor(private readonly sock: WebSocket, readonly timeout: number, qSize: number) {
    super(qSize)
  }

  static connect(url: string, timeout: number, qSize: number): Promise<WS> {
    const sock = new WebSocket(url)
    const t = new WS(sock, timeout, qSize)
    sock.onmessage = async ({data}: MessageEvent) => await t.queue.enqueue(data)
    sock.onclose = async () => await t.queue.close()
    sock.onerror = () => sock.close()
    return withTimeout(timeout, () => new Promise((r) => (sock.onopen = () => r(t))))
  }

  async close(): Promise<void> {
    this.sock.close()
    for await (const x of this.queue) await x
  }

  write(data: Uint8Array): Promise<void> {
    const buffered = this.sock.bufferedAmount
    this.sock.send(data)
    return withTimeout(this.timeout, async () => {
      while (this.sock.bufferedAmount > buffered) await delay()
    })
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

function delay(ms?: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function tPutEncrypted({conn, sndKey, blockSize}: THandle, data: ArrayBuffer): Promise<void> {
  const iv = nextIV(sndKey)
  const {encrypted, authTag} = await encryptAES(sndKey.aesKey, iv, blockSize - authTagSize, data)
  return conn.write(new Uint8Array(concat(authTag, encrypted)))
}

// TODO change server in v0.4 to match (auth tag should be appended to the end)
export async function tPutEncrypted1({conn, sndKey, blockSize}: THandle, data: ArrayBuffer): Promise<void> {
  const iv = nextIV(sndKey)
  const {encryptedAndTag} = await encryptAES(sndKey.aesKey, iv, blockSize - authTagSize, data)
  return conn.write(new Uint8Array(encryptedAndTag))
}

export async function tGetEncrypted({conn, rcvKey, blockSize}: THandle): Promise<ArrayBuffer> {
  return decryptBlock(rcvKey, await conn.read(blockSize))
}

async function decryptBlock(k: SessionKey, block: ArrayBuffer): Promise<ArrayBuffer> {
  const a = new Uint8Array(block)
  const authTag = a.subarray(0, 16)
  const encrypted = a.subarray(16)
  const iv = nextIV(k)
  return decryptAESData(k.aesKey, iv, {encrypted, authTag})
}

// TODO change server in v0.4 to match (auth tag should be appended to the end)
export async function tGetEncrypted1({conn, rcvKey, blockSize}: THandle): Promise<ArrayBuffer> {
  const block = await conn.read(blockSize)
  const iv = nextIV(rcvKey)
  return decryptAES(rcvKey.aesKey, iv, block)
}

function nextIV(k: SessionKey): ArrayBuffer {
  const c = new Uint8Array(encodeInt32(k.counter++))
  const start = k.baseIV.slice(0, 4)
  const rest = k.baseIV.slice(4)
  start.forEach((b, i) => (start[i] = b ^ c[i]))
  return concat(start, rest)
}

export interface THandle {
  readonly conn: Transport
  readonly sndKey: SessionKey
  readonly rcvKey: SessionKey
  readonly blockSize: number
}

interface SessionKey {
  readonly aesKey: AESKey
  readonly baseIV: Uint8Array
  counter: number
}

async function serializeSessionKey(k: SessionKey): Promise<ArrayBuffer> {
  return concat(await encodeAESKey(k.aesKey), k.baseIV)
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

async function serializeClientHandshake(h: ClientHandshake): Promise<ArrayBuffer> {
  return concatN(
    encodeInt32(h.blockSize),
    encodeInt16(binaryRsaTransport),
    await serializeSessionKey(h.sndKey),
    await serializeSessionKey(h.rcvKey)
  )
}

type SMPVersion = readonly [number, number, number, number]

const asciiDecoder = new TextDecoder("ascii")

function parseSMPVersion(block: ArrayBuffer): SMPVersion {
  // TODO better parsing
  const a = new Uint8Array(block)
  let i = 0
  while (i < 50 && i < a.length && a[i] !== 32) i++
  const version = asciiDecoder
    .decode(a.subarray(0, i))
    .split(".")
    .map((n) => +n)
  if (version.length === 4 && version.every((n) => !Number.isNaN(n))) return (version as unknown) as SMPVersion
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
export async function clientHandshake(conn: Transport, keyHash?: ArrayBuffer): Promise<THandle> {
  const {serverKey, blockSize} = await getHeaderAndPublicKey_1_2(conn, keyHash)
  const keys: ClientHandshake = await getClientHandshake_3(blockSize)
  await sendEncryptedKeys_4(conn, serverKey, keys)
  const th: THandle = {conn, ...keys}
  checkVersion(await getWelcome_6(th))
  return th
}

async function getHeaderAndPublicKey_1_2(c: Transport, keyHash?: ArrayBuffer): Promise<ServerHandshake> {
  const header = await c.read(serverHeaderSize)
  const {blockSize, keySize} = parseServerHeader(header)
  if (blockSize < transportBlockSize || blockSize > maxTransportBlockSize) {
    throw new TransportError(`transport handshake header error: bad block size ${blockSize}`)
  }
  const rawKey = await c.read(keySize)
  if (keyHash !== undefined) await validateKeyHash_2(rawKey, keyHash)
  const serverKey = await decodePublicKey(rawKey, KeyType.Encrypt)
  return {serverKey, blockSize}
}

async function validateKeyHash_2(rawKey: ArrayBuffer, keyHash: ArrayBuffer): Promise<void> {
  const hash = await sha256(rawKey)
  if (keyHash.byteLength === 32 && hash.byteLength === 32) {
    const h = new Uint32Array(hash)
    if (new Uint32Array(keyHash).every((n, i) => n === h[i])) return
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
    aesKey: await randomAESKey(),
    baseIV: new Uint8Array(randomIV()),
    counter: 0,
  }
}

async function sendEncryptedKeys_4(c: Transport, key: PublicKey<KeyType.Encrypt>, clientKeys: ClientHandshake): Promise<void> {
  return c.write(new Uint8Array(await encryptOAEP(key, await serializeClientHandshake(clientKeys))))
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
