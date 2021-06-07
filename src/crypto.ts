type KeyType = "encrypt" | "verify"

interface KeyInfo {
  algorithm: string
  usage: KeyUsage[]
}

const keyInfo: {[K in KeyType]: KeyInfo} = {
  encrypt: {
    algorithm: "RSA-OAEP",
    usage: ["encrypt", "decrypt"],
  },
  verify: {
    algorithm: "RSA-PSS",
    usage: ["sign", "verify"],
  },
}

type PublicKey = CryptoKey & {type: "public"}

type PrivateKey = CryptoKey & {type: "private"}

interface KeyPair {
  publicKey: PublicKey
  privateKey: PrivateKey
}

export class CryptoError extends Error {}

export async function generateKeyPair(size: number, keyType: KeyType): Promise<KeyPair> {
  const info = keyInfo[keyType]
  return (await crypto.subtle.generateKey(
    {name: info.algorithm, modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
    true,
    info.usage
  )) as KeyPair
}

export function encodePubKey(key: PublicKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("spki", key)
}

export function encodePrivKey(key: PrivateKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("pkcs8", key)
}

type AESKey = CryptoKey & {type: "secret"}

export async function randomAESKey(length = 256): Promise<AESKey> {
  return (await crypto.subtle.generateKey({name: "AES-GCM", length}, true, ["encrypt", "decrypt"])) as AESKey
}

export function randomIV(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(16)).buffer
}

const PADDING = "#".charCodeAt(0)

interface AESEncryptedData {
  readonly encryptedAndTag: ArrayBuffer // array buffer with encrypted data and appended auth tag
  readonly encryptedView: Uint8Array // view to encrypted data part
  readonly authTagView: Uint8Array // view to auth tag part
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
    encryptedView: enc.subarray(0, paddedSize),
    authTagView: enc.subarray(paddedSize),
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
