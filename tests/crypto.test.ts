import "./browser_globals"
import {
  KeyType,
  randomAESKey,
  randomIV,
  encryptAES,
  decryptAES,
  decryptAESData,
  generateKeyPair,
  encryptOAEP,
  decryptOAEP,
} from "../src/crypto"
import * as assert from "assert"

describe("AES-GCM encryption with padding", () => {
  test("encrypt and decrypt", async () => {
    const key = await randomAESKey()
    const iv = randomIV()
    const data = new TextEncoder().encode("hello")
    const res = await encryptAES(key, iv, 32, data)
    assert.strictEqual(res.encryptedView.byteLength, 32)
    assert.strictEqual(res.authTagView.byteLength, 16)
    assert.strictEqual(res.encryptedAndTag.byteLength, 32 + 16)

    await testDecryption(decryptAES(key, iv, res.encryptedView, res.authTagView))
    await testDecryption(decryptAESData(key, iv, res.encryptedAndTag))

    async function testDecryption(decryptRes: Promise<ArrayBuffer>): Promise<void> {
      const decrypted = await decryptRes
      const str = new TextDecoder().decode(decrypted)
      assert.strictEqual(str, "hello" + "#".repeat(32 - "hello".length))
    }
  })
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
