export enum KeyType {
  Encrypt = "encrypt",
  Verify = "verify",
}

enum PrivateType {
  Decrypt = "decrypt",
  Sign = "sign",
}

type PrivateUsage<T extends KeyType = KeyType> = T extends KeyType.Encrypt
  ? PrivateType.Decrypt
  : T extends KeyType.Verify
  ? PrivateType.Sign
  : PrivateType

interface KeyInfo<T extends KeyType> {
  readonly algorithm: string
  readonly usage: [T, PrivateUsage<T>]
}

const keyInfo: {[K in KeyType]: KeyInfo<K>} = {
  encrypt: {algorithm: "RSA-OAEP", usage: [KeyType.Encrypt, PrivateType.Decrypt]},
  verify: {algorithm: "RSA-PSS", usage: [KeyType.Verify, PrivateType.Sign]},
}

type PublicKey<T extends KeyType = KeyType> = CryptoKey & {
  type: "public"
  usages: [T]
  algorithm: RsaKeyAlgorithm
}

type PrivateKey<T extends PrivateType = PrivateType> = CryptoKey & {
  type: "private"
  usages: [T]
  algorithm: RsaKeyAlgorithm
}

interface KeyPair<T extends KeyType> {
  readonly publicKey: PublicKey<T>
  readonly privateKey: PrivateKey<PrivateUsage<T>>
}

export class CryptoError extends Error {}

export async function generateKeyPair<T extends KeyType>(size: number, keyType: T): Promise<KeyPair<T>> {
  const info = keyInfo[keyType]
  return (await crypto.subtle.generateKey(
    {name: info.algorithm, modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
    true,
    info.usage
  )) as KeyPair<T>
}

export function encodePubKey(key: PublicKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("spki", key)
}

export function encodePrivKey(key: PrivateKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("pkcs8", key)
}

interface Header {
  readonly aesKey: AESKey
  readonly ivBytes: ArrayBuffer
  readonly authTag: ArrayBuffer
  readonly msgSize: number
}

export async function serializeHeader(h: Header): Promise<ArrayBuffer> {
  const key = await crypto.subtle.exportKey("raw", h.aesKey)
  const size = new ArrayBuffer(4)
  new DataView(size).setUint32(0, h.msgSize)
  return concatN(key, h.ivBytes, h.authTag, size)
}

export async function parseHeader(b: ArrayBuffer): Promise<Header> {
  const a = new Uint8Array(b)
  const rawKey = a.subarray(0, 32)
  const aesKey = (await crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"])) as AESKey
  return {
    aesKey,
    ivBytes: a.subarray(32, 48),
    authTag: a.subarray(48, 64),
    msgSize: new DataView(b).getUint32(64),
  }
}

export async function encryptE2E(k: PublicKey<KeyType.Encrypt>, paddedSize: number, data: ArrayBuffer): Promise<ArrayBuffer> {
  const aesKey = await randomAESKey()
  const ivBytes = randomIV()
  const {authTag, encrypted} = await encryptAES(aesKey, ivBytes, paddedSize, data)
  const header = {aesKey, ivBytes, authTag, msgSize: data.byteLength}
  const encHeader = await encryptOAEP(k, await serializeHeader(header))
  return concat(encHeader, encrypted)
}

export async function decryptE2E(pk: PrivateKey<PrivateType.Decrypt>, data: ArrayBuffer): Promise<ArrayBuffer> {
  const encrypted = new Uint8Array(data)
  const keySize = pk.algorithm.modulusLength >> 3
  const header = encrypted.subarray(0, keySize)
  const msg = encrypted.subarray(keySize)
  const {aesKey, ivBytes, authTag, msgSize} = await parseHeader(await decryptOAEP(pk, header))
  const decrypted = await decryptAES(aesKey, ivBytes, msg, authTag)
  return new Uint8Array(decrypted).subarray(0, msgSize)
}

export function encryptOAEP(key: PublicKey<KeyType.Encrypt>, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt({name: "RSA-OAEP"}, key, data)
}

export function decryptOAEP(key: PrivateKey<PrivateType.Decrypt>, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({name: "RSA-OAEP"}, key, data)
}

type AESKey = CryptoKey & {type: "secret"; algorithm: AesKeyGenParams}

export async function randomAESKey(length = 256): Promise<AESKey> {
  return (await crypto.subtle.generateKey({name: "AES-GCM", length}, true, ["encrypt", "decrypt"])) as AESKey
}

export function randomIV(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(16)).buffer
}

const PADDING = "#".charCodeAt(0)

interface AESEncryptedData {
  readonly encryptedAndTag: ArrayBuffer // array buffer with encrypted data and appended auth tag
  readonly encrypted: Uint8Array // view to encrypted data part
  readonly authTag: Uint8Array // view to auth tag part
}

export async function encryptAES(key: AESKey, iv: ArrayBuffer, paddedSize: number, data: ArrayBuffer): Promise<AESEncryptedData> {
  if (data.byteLength >= paddedSize) throw new CryptoError("large message")
  const paddedData = new Uint8Array(paddedSize)
  paddedData.set(new Uint8Array(data), 0)
  paddedData.fill(PADDING, data.byteLength)
  const encryptedAndTag = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, paddedData)
  const enc = new Uint8Array(encryptedAndTag)
  return {
    encryptedAndTag,
    encrypted: enc.subarray(0, paddedSize),
    authTag: enc.subarray(paddedSize),
  }
}

export function decryptAESData(key: AESKey, iv: ArrayBuffer, encryptedAndTag: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({name: "AES-GCM", iv}, key, encryptedAndTag)
}

export function decryptAES(key: AESKey, iv: ArrayBuffer, encrypted: ArrayBuffer, authTag: ArrayBuffer): Promise<ArrayBuffer> {
  return decryptAESData(key, iv, concat(encrypted, authTag))
}

function concat(b1: ArrayBuffer, b2: ArrayBuffer): ArrayBuffer {
  const a = new Uint8Array(b1.byteLength + b2.byteLength)
  a.set(new Uint8Array(b1), 0)
  a.set(new Uint8Array(b2), b1.byteLength)
  return a.buffer
}

function concatN(...bs: ArrayBuffer[]): ArrayBuffer {
  const a = new Uint8Array(bs.reduce((size, b) => size + b.byteLength, 0))
  bs.reduce((offset, b: ArrayBuffer) => {
    a.set(new Uint8Array(b), offset)
    return offset + b.byteLength
  }, 0)
  return a.buffer
}
