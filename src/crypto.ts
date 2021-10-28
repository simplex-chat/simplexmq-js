import {concat, concatN, encodeInt32} from "./buffer"

export enum KeyType {
  Encrypt = "encrypt",
  Verify = "verify",
}

export enum PrivateType {
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

export type PrivateKey<T extends PrivateType = PrivateType> = CryptoKey & {
  type: "private"
  usages: [T]
  algorithm: RsaKeyAlgorithm
}

export type SignKey = PrivateKey<PrivateType.Sign>

interface KeyPair<T extends KeyType> {
  readonly publicKey: PublicKey<T>
  readonly privateKey: PrivateKey<PrivateUsage<T>>
}

export class CryptoError extends Error {}

export function generateKeyPair<T extends KeyType>(size: number, keyType: T): Promise<KeyPair<T>> {
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
  readonly ivBytes: Uint8Array
  readonly authTag: Uint8Array
  readonly msgSize: number
}

export async function serializeHeader(h: Header): Promise<Uint8Array> {
  const key = new Uint8Array(await encodeAESKey(h.aesKey))
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
  const {authTag, encrypted} = await encryptAESData(aesKey, ivBytes, paddedSize, data)
  const header = {aesKey, ivBytes, authTag, msgSize: data.byteLength}
  const encHeader = await encryptOAEP(k, await serializeHeader(header))
  return concat(new Uint8Array(encHeader), encrypted)
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

export async function sign(key: PrivateKey<PrivateType.Sign>, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.sign({name: "RSA-PSS", saltLength: 32}, key, data)
}

export function verify(key: PublicKey<KeyType.Verify>, sig: ArrayBuffer, data: ArrayBuffer): Promise<boolean> {
  return crypto.subtle.verify({name: "RSA-PSS", saltLength: 32}, key, sig, data)
}

export type AESKey = CryptoKey & {type: "secret"; algorithm: AesKeyGenParams}

export function randomAESKey(length = 256): Promise<AESKey> {
  return crypto.subtle.generateKey({name: "AES-GCM", length}, true, ["encrypt", "decrypt"]) as Promise<AESKey>
}

export function encodeAESKey(key: AESKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key)
}

export function decodeAESKey(rawKey: ArrayBuffer): Promise<AESKey> {
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"]) as Promise<AESKey>
}

export function randomIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

const PADDING = "#".charCodeAt(0)

export const authTagSize = 16

interface AESEncryptedData {
  readonly encrypted: Uint8Array // view to encrypted data part
  readonly authTag: Uint8Array // view to auth tag part
}

export async function encryptAES(key: AESKey, iv: ArrayBuffer, padTo: number, data: ArrayBuffer): Promise<ArrayBuffer> {
  if (data.byteLength >= padTo) throw new CryptoError("large message")
  const padded = new Uint8Array(padTo)
  padded.set(new Uint8Array(data), 0)
  padded.fill(PADDING, data.byteLength)
  return crypto.subtle.encrypt({name: "AES-GCM", iv}, key, padded)
}

export async function encryptAESData(key: AESKey, iv: ArrayBuffer, padTo: number, data: ArrayBuffer): Promise<AESEncryptedData> {
  const enc = new Uint8Array(await encryptAES(key, iv, padTo, data))
  return {
    encrypted: enc.subarray(0, padTo),
    authTag: enc.subarray(padTo),
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
