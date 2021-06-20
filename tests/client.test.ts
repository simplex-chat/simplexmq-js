import "./browser_globals"
import {SMPClient, ServerMessage, smpDefaultConfig} from "../src/client"
import {ABQueue} from "../src/queue"
import {KeyType} from "../src/crypto"
import * as B from "../src/buffer"
import * as C from "../src/crypto"
import * as SMP from "../src/protocol"
import * as assert from "assert"

describe.skip("SMPClient (expects SMP server on localhost:80)", () => {
  const keyHash: Uint8Array | undefined = B.decodeBase64(B.encodeAscii("bU0K+bRg24xWW//lS0umO1Zdw/SXqpJNtm1/RrPLViE="))

  test("should create queue and sent/receive message", async (done) => {
    const msgQ = new ABQueue<ServerMessage>(smpDefaultConfig.qSize)
    const alice = await SMPClient.create({host: "localhost", keyHash}, smpDefaultConfig, msgQ)
    const {publicKey: pubRcvKey, privateKey: rcvKey} = await C.generateKeyPair(2048, KeyType.Verify)
    const rcvKeyStr = new Uint8Array(await C.encodePubKey(pubRcvKey))
    const resp = await alice.sendSMPCommand(rcvKey, B.empty, SMP.cNEW(rcvKeyStr))
    assert.strictEqual(resp.cmd, "IDS")
    await alice.disconnect()
    await alice.client
    await msgQ.close()
    done()
  })
})
