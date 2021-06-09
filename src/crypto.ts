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
  readonly privateUsage: PrivateUsage<T>
}

const keyInfo: {[K in KeyType]: KeyInfo<K>} = {
  encrypt: {algorithm: "RSA-OAEP", privateUsage: PrivateType.Decrypt},
  verify: {algorithm: "RSA-PSS", privateUsage: PrivateType.Sign},
}

export type PublicKey<T extends KeyType = KeyType> = CryptoKey & {
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
  return crypto.subtle.generateKey(
    {name: info.algorithm, modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
    true,
    [keyType, info.privateUsage]
  ) as Promise<KeyPair<T>>
}

export function encodePubKey(key: PublicKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("spki", key)
}

export function decodePublicKey<T extends KeyType>(rawKey: ArrayBuffer, keyType: T): Promise<PublicKey<T>> {
  const info = keyInfo[keyType]
  return crypto.subtle.importKey("spki", rawKey, {name: info.algorithm, hash: "SHA-256"}, true, [keyType]) as Promise<
    PublicKey<T>
  >
}

export function encodePrivKey(key: PrivateKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("pkcs8", key)
}

export function decodePrivateKey<T extends KeyType>(rawKey: ArrayBuffer, keyType: T): Promise<PrivateKey<PrivateUsage<T>>> {
  const info = keyInfo[keyType]
  return crypto.subtle.importKey("pkcs8", rawKey, {name: info.algorithm, hash: "SHA-256"}, true, [info.privateUsage]) as Promise<
    PrivateKey<PrivateUsage<T>>
  >
}

interface Header {
  readonly aesKey: AESKey
  readonly ivBytes: ArrayBuffer
  readonly authTag: ArrayBuffer
  readonly msgSize: number
}

export async function serializeHeader(h: Header): Promise<ArrayBuffer> {
  const key = await encodeAESKey(h.aesKey)
  return concatN(key, h.ivBytes, h.authTag, encodeInt32(h.msgSize))
}

export async function parseHeader(b: ArrayBuffer): Promise<Header> {
  const a = new Uint8Array(b)
  return {
    aesKey: await decodeAESKey(a.subarray(0, 32)),
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
  const decrypted = await decryptAESData(aesKey, ivBytes, {encrypted: msg, authTag})
  return new Uint8Array(decrypted).subarray(0, msgSize)
}

export function encryptOAEP(key: PublicKey<KeyType.Encrypt>, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt({name: "RSA-OAEP"}, key, data)
}

export function decryptOAEP(key: PrivateKey<PrivateType.Decrypt>, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({name: "RSA-OAEP"}, key, data)
}

export interface Signature {
  signature: ArrayBuffer
}

export async function sign(key: PrivateKey<PrivateType.Sign>, data: ArrayBuffer): Promise<Signature> {
  return {signature: await crypto.subtle.sign({name: "RSA-PSS", saltLength: 32}, key, data)}
}

export function verify(key: PublicKey<KeyType.Verify>, sig: Signature, data: ArrayBuffer): Promise<boolean> {
  return crypto.subtle.verify({name: "RSA-PSS", saltLength: 32}, key, sig.signature, data)
}

export type AESKey = CryptoKey & {type: "secret"; algorithm: AesKeyGenParams}

export async function randomAESKey(length = 256): Promise<AESKey> {
  return crypto.subtle.generateKey({name: "AES-GCM", length}, true, ["encrypt", "decrypt"]) as Promise<AESKey>
}

export function encodeAESKey(key: AESKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key)
}

export function decodeAESKey(rawKey: ArrayBuffer): Promise<AESKey> {
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"]) as Promise<AESKey>
}

export function randomIV(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(16)).buffer
}

const PADDING = "#".charCodeAt(0)

export const authTagSize = 16

interface AESEncryptedData {
  readonly encryptedAndTag?: ArrayBuffer // array buffer with encrypted data and appended auth tag
  readonly encrypted: ArrayBuffer // view to encrypted data part
  readonly authTag: ArrayBuffer // view to auth tag part
}

export async function encryptAES(
  key: AESKey,
  iv: ArrayBuffer,
  paddedSize: number,
  data: ArrayBuffer
): Promise<Required<AESEncryptedData>> {
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

export function decryptAES(key: AESKey, iv: ArrayBuffer, encryptedAndTag: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({name: "AES-GCM", iv}, key, encryptedAndTag)
}

export function decryptAESData(key: AESKey, iv: ArrayBuffer, e: AESEncryptedData): Promise<ArrayBuffer> {
  return decryptAES(key, iv, concat(e.encrypted, e.authTag))
}

export function sha256(data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", data)
}

export function concat(b1: ArrayBuffer, b2: ArrayBuffer): ArrayBuffer {
  const a = new Uint8Array(b1.byteLength + b2.byteLength)
  a.set(new Uint8Array(b1), 0)
  a.set(new Uint8Array(b2), b1.byteLength)
  return a.buffer
}

export function concatN(...bs: ArrayBuffer[]): ArrayBuffer {
  const a = new Uint8Array(bs.reduce((size, b) => size + b.byteLength, 0))
  bs.reduce((offset, b: ArrayBuffer) => {
    a.set(new Uint8Array(b), offset)
    return offset + b.byteLength
  }, 0)
  return a.buffer
}

export function encodeInt32(n: number): ArrayBuffer {
  const res = new ArrayBuffer(4)
  new DataView(res).setUint32(0, n)
  return res
}

export function encodeInt16(n: number): ArrayBuffer {
  const res = new ArrayBuffer(2)
  new DataView(res).setUint16(0, n)
  return res
}
