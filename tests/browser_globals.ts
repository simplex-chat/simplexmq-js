/* eslint-disable @typescript-eslint/no-var-requires */
const Ws = require("isomorphic-ws") as typeof WebSocket

Object.defineProperty(global, "WebSocket", {value: Ws})

const cr = require("isomorphic-webcrypto") as typeof crypto

Object.defineProperty(global, "crypto", {value: cr})
