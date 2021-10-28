import "./browser_globals"
import {SMPClient, ServerMessage, smpDefaultConfig} from "../src/client"
import {ABQueue} from "../src/queue"
import {KeyType} from "../src/crypto"
import * as B from "../src/buffer"
import * as C from "../src/crypto"
import * as assert from "assert"

describe.skip("SMPClient (expects SMP server on localhost:80)", () => {
  const keyHash: Uint8Array | undefined = B.decodeBase64(B.encodeAscii("bU0K+bRg24xWW//lS0umO1Zdw/SXqpJNtm1/RrPLViE="))

  test("should create queue and sent/receive message", async (done) => {
    const smpServer = {host: "localhost", keyHash}

    const aliceQ = new ABQueue<ServerMessage>(smpDefaultConfig.qSize)
    const bobQ = new ABQueue<ServerMessage>(smpDefaultConfig.qSize)
    const alice = await SMPClient.create(smpServer, smpDefaultConfig, aliceQ)
    const bob = await SMPClient.create(smpServer, smpDefaultConfig, bobQ)
    const {publicKey: pubRcvKey, privateKey: rcvKey} = await C.generateKeyPair(2048, KeyType.Verify)
    const {publicKey: pubSndKey, privateKey: sndKey} = await C.generateKeyPair(2048, KeyType.Verify)
    const {rcvId, sndId} = await alice.createSMPQueue(rcvKey, pubRcvKey)
    await bob.sendSMPMessage(undefined, sndId, new Uint8Array(await C.encodePubKey(pubSndKey)))
    const {server: s1, queueId: q1, command: r1} = await aliceQ.dequeue()
    assert.deepStrictEqual(s1, smpServer)
    assert.deepStrictEqual(q1, rcvId)
    assert(r1.cmd === "MSG")
    const bobPubKey = await C.decodePublicKey(r1.msgBody, KeyType.Verify)
    await alice.ackSMPMessage(rcvKey, rcvId)
    await alice.secureSMPQueue(rcvKey, rcvId, bobPubKey)
    await bob.sendSMPMessage(sndKey, sndId, B.encodeAscii("hello alice"))
    const {server: s2, queueId: q2, command: r2} = await aliceQ.dequeue()
    assert.deepStrictEqual(s2, smpServer)
    assert.deepStrictEqual(q2, rcvId)
    assert(r2.cmd === "MSG")
    assert.deepStrictEqual(r2.msgBody, B.encodeAscii("hello alice"))
    await alice.ackSMPMessage(rcvKey, rcvId)
    await alice.disconnect()
    await aliceQ.close()
    await bob.disconnect()
    await bobQ.close()
    done()
  })
})
