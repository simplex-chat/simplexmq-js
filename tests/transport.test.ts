import "./browser_globals"
import {WSTransport, SMPTransport, clientHandshake} from "../src/transport"
import {encodeAscii, decodeBase64} from "../src/buffer"
import * as B from "../src/buffer"
import * as C from "../src/crypto"
import {KeyType} from "../src/crypto"
import * as SMP from "../src/protocol"
import * as Ws from "ws"
import * as assert from "assert"

describe("WS: WebSocket client transport", () => {
  test("transport API", async (done) => {
    const server = new Ws.Server({port: 8080, perMessageDeflate: false})
    await event(server, "listening")
    const [sock, client] = await Promise.all([
      event<Ws>(server, "connection"),
      WSTransport.connect("ws://localhost:8080", 1000, 10),
    ])
    await client.write(new TextEncoder().encode("hello"))
    const msg = await event<Uint8Array>(sock, "message")
    assert.strictEqual(new TextDecoder().decode(msg), "hello")
    server.close()
    await Promise.all([event(server, "close"), client.close()])
    done()

    function event<T>(emitter: Ws.Server | Ws, eventName: string): Promise<T> {
      return new Promise<T>((r) => emitter.once(eventName, r))
    }
  })
})

describe.skip("SMP transport (expects SMP server on localhost:80)", () => {
  const keyHash: Uint8Array | undefined = decodeBase64(encodeAscii("bU0K+bRg24xWW//lS0umO1Zdw/SXqpJNtm1/RrPLViE="))

  test("transport handshake should agree session keys via WSTransport", async (done) => {
    const conn = await WSTransport.connect("ws://localhost:80", 1000, 10)
    const th = await clientHandshake(conn, keyHash)
    assert(th.conn instanceof WSTransport)
    await conn.close()
    done()
  })

  test("transport handshake should agree session keys via SMPTransport", async (done) => {
    const t = await SMPTransport.connect({host: "localhost", keyHash}, 1000, 10)
    assert(t instanceof SMPTransport)
    await t.close()
    done()
  })

  test("should create SMP queue and send message", async (done) => {
    const alice = await SMPTransport.connect({host: "localhost", keyHash}, 1000, 10)
    const bob = await SMPTransport.connect({host: "localhost", keyHash}, 1000, 10)
    const {publicKey: pubRcvKey, privateKey: rcvKey} = await C.generateKeyPair(2048, KeyType.Verify)
    const rcvKeyStr = new Uint8Array(await C.encodePubKey(pubRcvKey))
    await alice.write({key: rcvKey, corrId: encodeAscii("1"), queueId: B.empty, command: SMP.cNEW(rcvKeyStr)})
    const {corrId: corrId1, command: resp1} = await alice.read()
    assert.deepStrictEqual(corrId1, encodeAscii("1"))
    assert.strictEqual(resp1?.cmd, "IDS")
    const {rcvId, sndId} = resp1 as SMP.IDS

    const {publicKey: pubSndKey, privateKey: sndKey} = await C.generateKeyPair(2048, KeyType.Verify)
    const sndKeyStr = new Uint8Array(await C.encodePubKey(pubSndKey))
    await alice.write({key: rcvKey, corrId: encodeAscii("2"), queueId: rcvId, command: SMP.cKEY(sndKeyStr)})
    const {corrId: corrId2, queueId: qId2, command: resp2} = await alice.read()
    assert.deepStrictEqual(corrId2, encodeAscii("2"))
    assert.deepStrictEqual(qId2, rcvId)
    assert.strictEqual(resp2?.cmd, "OK")

    await bob.write({key: sndKey, corrId: encodeAscii("3"), queueId: sndId, command: SMP.cSEND(encodeAscii("hello"))})
    const {corrId: corrId3, queueId: qId3, command: resp3} = await bob.read()
    assert.deepStrictEqual(corrId3, encodeAscii("3"))
    assert.deepStrictEqual(qId3, sndId)
    assert.strictEqual(resp3?.cmd, "OK")

    const {corrId: corrId4, queueId: qId4, command: resp4} = await alice.read()
    assert.deepStrictEqual(corrId4, B.empty)
    assert.deepStrictEqual(qId4, rcvId)
    assert.strictEqual(resp4?.cmd, "MSG")
    assert.deepStrictEqual(resp4.msgBody, encodeAscii("hello"))

    await alice.close()
    await bob.close()
    done()
  })
})
