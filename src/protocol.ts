import {Parser} from "./parser"

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

interface Command<P extends Party, C extends CmdTag<P> = CmdTag<P>> {
  party: P
  cmd: C
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

export type SomeCommand = NEW | SUB | KEY | ACK | OFF | DEL | SEND | PING | IDS | MSG | END | OK | ERR | PONG

// command constructors
const cNEW = (key: string): NEW => ({cmd: "NEW", party: Party.Recipient, rcvPubKey: key})
const cSUB = (): SUB => ({cmd: "SUB", party: Party.Recipient})
const cKEY = (key: string): KEY => ({cmd: "KEY", party: Party.Recipient, sndPubKey: key})
const cACK = (): ACK => ({cmd: "ACK", party: Party.Recipient})
const cOFF = (): OFF => ({cmd: "OFF", party: Party.Recipient})
const cDEL = (): DEL => ({cmd: "DEL", party: Party.Recipient})
const cSEND = (msg: string): SEND => ({cmd: "SEND", party: Party.Sender, msgBody: msg})
const cPING = (): PING => ({cmd: "PING", party: Party.Sender})
const cIDS = (rcvId: string, sndId: string): IDS => ({cmd: "IDS", party: Party.Broker, rcvId, sndId})
const cMSG = (msgId: string, ts: Date, msgBody: string): MSG => ({cmd: "MSG", party: Party.Broker, msgId, ts, msgBody})
const cEND = (): END => ({cmd: "END", party: Party.Broker})
const cOK = (): OK => ({cmd: "OK", party: Party.Broker})
const cERR = <E extends ErrorType>(error: E, cmdError: ErrorSubType<E>): ERR<E> => ({
  cmd: "ERR",
  party: Party.Broker,
  error,
  cmdError,
})
const cPONG = (): PONG => ({cmd: "PONG", party: Party.Broker})

export function serializeSMPCommand(c: SomeCommand): string {
  return c.cmd === "NEW"
    ? `NEW ${serializePubKey(c.rcvPubKey)}`
    : c.cmd === "KEY"
    ? `KEY ${serializePubKey(c.sndPubKey)}`
    : c.cmd === "SEND"
    ? `SEND ${serializeMsg(c.msgBody)}`
    : c.cmd === "IDS"
    ? `IDS ${encode64(c.rcvId)} ${encode64(c.sndId)}`
    : c.cmd === "MSG"
    ? `MSG ${encode64(c.msgId)} ${c.ts.toISOString()} ${serializeMsg(c.msgBody)}`
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
function encode64(bytes: string): string {
  return bytes
}

// TODO stub
function byteLength(s: string): number {
  return s.length
}

export const smpCmdParsers: {
  [T in CmdTag]: (p: Parser) => (SomeCommand & Command<Party, T>) | undefined | false | ""
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
      p.space() &&
      (msgId = b64P(p)) &&
      p.space() &&
      (ts = p.date()) &&
      p.space() &&
      (msg = messageP(p)) &&
      cMSG(msgId, ts, msg)
    )
  },
  END: cEND,
  OK: cOK,
  ERR: (p) => {
    const err = p.space() && p.someStr(smpErrors)
    let cmdErr: CMDErrorType | undefined
    return err === "CMD"
      ? p.space() && (cmdErr = p.someStr(smpCmdErrors)) && cERR("CMD", cmdErr)
      : err && cERR(err, undefined)
  },
  PONG: cPONG,
}

export function smpCommandP(p: Parser): SomeCommand | undefined {
  let cmd: CmdTag | undefined
  return ((cmd = p.someStr(cmdTags)) && smpCmdParsers[cmd](p)) || undefined
}

// TODO stub
function pubKeyP(p: Parser): string | undefined {
  return p.word()
}

// TODO stub
function b64P(p: Parser): string | undefined {
  return p.word()
}

function messageP(p: Parser): string | undefined {
  let len: number | undefined
  let msg: string | undefined
  return ((len = p.decimal()) && p.space() && (msg = p.take(len)) && p.space() && msg) || undefined
}
