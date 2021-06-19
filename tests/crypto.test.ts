import "./browser_globals"
import {
  KeyType,
  randomAESKey,
  randomIV,
  encryptAES,
  decryptAES,
  encryptAESData,
  decryptAESData,
  generateKeyPair,
  encryptOAEP,
  decryptOAEP,
  encryptE2E,
  decryptE2E,
  sign,
  verify,
} from "../src/crypto"
import * as assert from "assert"

describe("AES-GCM encryption with padding", () => {
  test("encrypt and decrypt with appended auth tag", async () => {
    const key = await randomAESKey()
    const iv = randomIV()
    const data = new TextEncoder().encode("hello")
    const res = await encryptAES(key, iv, 32, data)
    assert.strictEqual(res.byteLength, 32 + 16)
    testDecryption(await decryptAES(key, iv, res))
  })

  test("encrypt and decrypt", async () => {
    const key = await randomAESKey()
    const iv = randomIV()
    const data = new TextEncoder().encode("hello")
    const res = await encryptAESData(key, iv, 32, data)
    assert.strictEqual(res.encrypted.byteLength, 32)
    assert.strictEqual(res.authTag.byteLength, 16)
    testDecryption(await decryptAESData(key, iv, res))
  })

  function testDecryption(decrypted: ArrayBuffer): void {
    const str = new TextDecoder().decode(decrypted)
    assert.strictEqual(str, "hello" + "#".repeat(32 - "hello".length))
  }
})

describe("RSA-OAEP encryption", () => {
  test("encrypt and decrypt", async () => {
    const {publicKey, privateKey} = await generateKeyPair(2048, KeyType.Encrypt)
    const data = new TextEncoder().encode("hello there")
    const encrypted = await encryptOAEP(publicKey, data)
    assert.strictEqual(encrypted.byteLength, 2048 / 8)

    const decrypted = await decryptOAEP(privateKey, encrypted)
    assert.strictEqual(new TextDecoder().decode(decrypted), "hello there")
  })
})

describe("RSA-PSS signature verification", () => {
  test("sign and verify", async () => {
    const {publicKey, privateKey} = await generateKeyPair(2048, KeyType.Verify)
    const data = new TextEncoder().encode("hello there")
    const sig = await sign(privateKey, data)
    const ok = await verify(publicKey, sig, data)
    assert.strictEqual(ok, true)
  })
})

describe("SMP agent E2E encryption", () => {
  test("encrypt and decrypt", async () => {
    const {publicKey, privateKey} = await generateKeyPair(2048, KeyType.Encrypt)
    const data = new TextEncoder().encode("hello there again")
    const encrypted = await encryptE2E(publicKey, 1024, data)
    assert.strictEqual(encrypted.byteLength, 1024 + 256)

    const decrypted = await decryptE2E(privateKey, encrypted)
    assert.strictEqual(new TextDecoder().decode(decrypted), "hello there again")
  })
})
