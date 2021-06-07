import {ABQueue} from "./queue"

export class TransportError extends Error {}

export abstract class Transport {
  readonly queue: ABQueue<string>

  protected constructor(qSize: number) {
    this.queue = new ABQueue(qSize)
  }

  abstract close(): Promise<void>

  abstract write(bytes: string): Promise<void>

  async read(count: number): Promise<string> {
    const data = await this.queue.dequeue()
    if (data.length === count) return data
    throw new TransportError("invalid block size")
  }
}

export class WS extends Transport {
  private constructor(private readonly sock: WebSocket, readonly timeout: number, qSize: number) {
    super(qSize)
  }

  static connect(url: string, timeout: number, qSize: number): Promise<WS> {
    const sock = new WebSocket(url)
    const t = new WS(sock, timeout, qSize)
    sock.onmessage = async ({data}: MessageEvent) => await t.queue.enqueue(data)
    sock.onclose = async () => await t.queue.close()
    sock.onerror = () => sock.close()
    return withTimeout(timeout, () => new Promise((r) => (sock.onopen = () => r(t))))
  }

  async close(): Promise<void> {
    this.sock.close()
    for await (const x of this.queue) await x
  }

  write(data: string): Promise<void> {
    const buffered = this.sock.bufferedAmount
    this.sock.send(data)
    return withTimeout(this.timeout, async () => {
      while (this.sock.bufferedAmount > buffered) await delay()
    })
  }
}

function withTimeout<T>(ms: number, action: () => Promise<T>): Promise<T> {
  return Promise.race([
    action(),
    (async () => {
      await delay(ms)
      throw new Error("timeout")
    })(),
  ])
}

function delay(ms?: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// export class THandle {
//   constructor(
//     private readonly conn: Transport,
//     private readonly sndKey: SessionKey,
//     private readonly rcvKey: SessionKey,
//     private readonly blockSize: number
//   ) {}
// }

// interface SessionKey {
//   aesKey:
//   baseIV:
//   counter: number
// }
