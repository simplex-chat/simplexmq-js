import {Parser, isAlphaNum} from "./parser"

enum Party {
  Recipient = "R",
  Sender = "S",
  Broker = "B",
}

const recipientCmdTags = ["NEW", "SUB", "KEY", "ACK", "OFF", "DEL"] as const

type RecipientCmdTag = typeof recipientCmdTags[number]

const senderCmdTags = ["SEND", "PING"] as const

type SenderCmdTag = typeof senderCmdTags[number]

const brokerCmdTags = ["IDS", "MSG", "END", "OK", "ERR", "PONG"] as const

type BrokerCmdTag = typeof brokerCmdTags[number]

type CmdTag<P extends Party = Party> = P extends Party.Recipient
  ? RecipientCmdTag
  : P extends Party.Sender
  ? SenderCmdTag
  : P extends Party.Broker
  ? BrokerCmdTag
  : P extends Party.Recipient | Party.Sender
  ? RecipientCmdTag | SenderCmdTag
  : RecipientCmdTag | SenderCmdTag | BrokerCmdTag

export const cmdTags = [...recipientCmdTags, ...senderCmdTags, ...brokerCmdTags] as const

interface Command<P extends Party, C extends CmdTag<P>> {
  party: P
  cmd: C
  [x: string]: unknown
}

type NEW = Command<Party.Recipient, "NEW"> & {rcvPubKey: string} // TODO type
type SUB = Command<Party.Recipient, "SUB">
type KEY = Command<Party.Recipient, "KEY"> & {sndPubKey: string} // TODO type
type ACK = Command<Party.Recipient, "ACK">
type OFF = Command<Party.Recipient, "OFF">
type DEL = Command<Party.Recipient, "DEL">
type SEND = Command<Party.Sender, "SEND"> & {msgBody: string} // TODO type?
type PING = Command<Party.Sender, "PING">
type IDS = Command<Party.Broker, "IDS"> & {rcvId: string; sndId: string} // TODO type?
type MSG = Command<Party.Broker, "MSG"> & {msgId: string; ts: Date; msgBody: string} // TODO types?
type END = Command<Party.Broker, "END">
type OK = Command<Party.Broker, "OK">
type ERR<E extends ErrorType = ErrorType> = Command<Party.Broker, "ERR"> & {error: E; cmdError: ErrorSubType<E>}
type PONG = Command<Party.Broker, "PONG">

const smpErrors = ["BLOCK", "CMD", "AUTH", "NO_MSG", "INTERNAL"] as const

type ErrorType = typeof smpErrors[number]

const smpCmdErrors = ["PROHIBITED", "KEY_SIZE", "SYNTAX", "NO_AUTH", "HAS_AUTH", "NO_QUEUE"] as const

type CMDErrorType = typeof smpCmdErrors[number]

type ErrorSubType<E extends ErrorType> = E extends "CMD" ? CMDErrorType : undefined

export type SMPCommand<P extends Party = Party, C extends CmdTag<P> = CmdTag<P>> = Command<P, C> &
  (NEW | SUB | KEY | ACK | OFF | DEL | SEND | PING | IDS | MSG | END | OK | ERR | PONG)

// command constructors
export const cNEW = (key: string): NEW => ({cmd: "NEW", party: Party.Recipient, rcvPubKey: key})
export const cSUB = (): SUB => ({cmd: "SUB", party: Party.Recipient})
export const cKEY = (key: string): KEY => ({cmd: "KEY", party: Party.Recipient, sndPubKey: key})
export const cACK = (): ACK => ({cmd: "ACK", party: Party.Recipient})
export const cOFF = (): OFF => ({cmd: "OFF", party: Party.Recipient})
export const cDEL = (): DEL => ({cmd: "DEL", party: Party.Recipient})
export const cSEND = (msg: string): SEND => ({cmd: "SEND", party: Party.Sender, msgBody: msg})
export const cPING = (): PING => ({cmd: "PING", party: Party.Sender})
export const cIDS = (rcvId: string, sndId: string): IDS => ({cmd: "IDS", party: Party.Broker, rcvId, sndId})
export const cMSG = (msgId: string, ts: Date, msgBody: string): MSG => ({cmd: "MSG", party: Party.Broker, msgId, ts, msgBody})
export const cEND = (): END => ({cmd: "END", party: Party.Broker})
export const cOK = (): OK => ({cmd: "OK", party: Party.Broker})
export const cERR = <E extends ErrorType>(error: E, cmdError: ErrorSubType<E>): ERR<E> => ({
  cmd: "ERR",
  party: Party.Broker,
  error,
  cmdError,
})
export const cPONG = (): PONG => ({cmd: "PONG", party: Party.Broker})

export function serializeSMPCommand(c: SMPCommand): string {
  return c.cmd === "NEW"
    ? `NEW ${serializePubKey(c.rcvPubKey)}`
    : c.cmd === "KEY"
    ? `KEY ${serializePubKey(c.sndPubKey)}`
    : c.cmd === "SEND"
    ? `SEND ${serializeMsg(c.msgBody)}`
    : c.cmd === "IDS"
    ? `IDS ${btoa(c.rcvId)} ${btoa(c.sndId)}`
    : c.cmd === "MSG"
    ? `MSG ${btoa(c.msgId)} ${c.ts.toISOString()} ${serializeMsg(c.msgBody)}`
    : c.cmd === "ERR"
    ? // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `ERR ${c.error === "CMD" ? `CMD ${c.cmdError}` : c.error}`
    : c.cmd
}

function serializeMsg(msg: string): string {
  return `${byteLength(msg)} ${msg} ` // the trailing space is required
}

// TODO stub
function serializePubKey(rcvPubKey: string): string {
  return rcvPubKey
}

// TODO stub
function byteLength(s: string): number {
  return s.length
}

export const smpCmdParsers: {
  [T in CmdTag]: (p: Parser) => SMPCommand<Party, T> | undefined | ""
} = {
  NEW: (p) => {
    let key: string | undefined
    return p.space() && (key = pubKeyP(p)) && cNEW(key)
  },
  SUB: cSUB,
  KEY: (p) => {
    let key: string | undefined
    return p.space() && (key = pubKeyP(p)) && cKEY(key)
  },
  ACK: cACK,
  OFF: cOFF,
  DEL: cDEL,
  SEND: (p) => {
    let msg: string | undefined
    return p.space() && (msg = messageP(p)) && cSEND(msg)
  },
  PING: cPING,
  IDS: (p) => {
    let rId, sId: string | undefined
    return p.space() && (rId = b64P(p)) && p.space() && (sId = b64P(p)) && cIDS(rId, sId)
  },
  MSG: (p) => {
    let msgId, msg: string | undefined
    let ts: Date | undefined
    return (
      p.space() && (msgId = b64P(p)) && p.space() && (ts = p.date()) && p.space() && (msg = messageP(p)) && cMSG(msgId, ts, msg)
    )
  },
  END: cEND,
  OK: cOK,
  ERR: (p) => {
    const err = p.space() && p.someStr(smpErrors)
    let cmdErr: CMDErrorType | undefined
    return err === "CMD" ? p.space() && (cmdErr = p.someStr(smpCmdErrors)) && cERR("CMD", cmdErr) : err && cERR(err, undefined)
  },
  PONG: cPONG,
}

export function parseSMPCommand(s: string): SMPCommand | undefined {
  const p = new Parser(s)
  const cmd = smpCommandP(p)
  return cmd && p.end() ? cmd : undefined
}

export function smpCommandP(p: Parser): SMPCommand | undefined {
  let cmd: CmdTag | undefined
  return ((cmd = p.someStr(cmdTags)) && smpCmdParsers[cmd](p)) || undefined
}

// TODO stub
function pubKeyP(p: Parser): string | undefined {
  return p.word()
}

function b64P(p: Parser): string | undefined {
  let ds, s: string | undefined
  return (ds = p.takeWhile1(isAlphaNum)) && (s = ds + p.takeWhileChar("=")).length % 4 === 0 ? atob(s) : undefined
}

function messageP(p: Parser): string | undefined {
  let len: number | undefined
  let msg: string | undefined
  return ((len = p.decimal()) && p.space() && (msg = p.take(len)) && p.space() && msg) || undefined
}
