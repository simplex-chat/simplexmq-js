// eslint-disable-next-line @typescript-eslint/no-var-requires
const Ws = require("isomorphic-ws") as typeof WebSocket

Object.defineProperty(global, "WebSocket", {value: Ws})

export function atob(s: string): string {
  return Buffer.from(s, "base64").toString()
}

Object.defineProperty(global, "atob", {value: atob})

export function btoa(s: string): string {
  return Buffer.from(s).toString("base64")
}

Object.defineProperty(global, "btoa", {value: btoa})
