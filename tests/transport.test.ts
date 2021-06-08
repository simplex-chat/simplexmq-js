import "./browser_globals"
import {WS, clientHandshake} from "../src/transport"
import * as Ws from "ws"
import * as assert from "assert"

describe("WS: WebSocket client transport", () => {
  test("transport API", async () => {
    const server = new Ws.Server({port: 8080, perMessageDeflate: false})
    await event(server, "listening")
    const [sock, client] = await Promise.all([event<Ws>(server, "connection"), WS.connect("ws://localhost:8080", 1000, 10)])
    await client.write(new TextEncoder().encode("hello"))
    const msg = await event<Uint8Array>(sock, "message")
    assert.strictEqual(new TextDecoder().decode(msg), "hello")
    server.close()
    await Promise.all([event(server, "close"), client.close()])

    function event<T>(emitter: Ws.Server | Ws, eventName: string): Promise<T> {
      return new Promise<T>((r) => emitter.once(eventName, r))
    }
  })
})

describe.skip("SMP transport handshake", () => {
  test("should agree session keys (expects SMP server on localhost:80)", async () => {
    const conn = await WS.connect("ws://localhost:80", 1000, 10)
    const th = await clientHandshake(conn)
    assert(th.conn instanceof WS)
    await conn.close()
  })
})
