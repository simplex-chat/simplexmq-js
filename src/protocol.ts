import {concat, unwords, unwordsN, encodeAscii, encodeBase64, empty} from "./buffer"
import {BinaryTags, Parser} from "./parser"

export enum Party {
  Recipient = "R",
  Sender = "S",
  Broker = "B",
}

const recipientCmdTags = ["NEW", "SUB", "KEY", "ACK", "OFF", "DEL"] as const

type RecipientCmdTag = typeof recipientCmdTags[number]

const senderCmdTags = ["SEND", "PING"] as const

type SenderCmdTag = typeof senderCmdTags[number]

export const brokerCmdTags = ["IDS", "MSG", "END", "OK", "ERR", "PONG"] as const

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

export interface Command<P extends Party, C extends CmdTag<P>> {
  readonly party: P
  readonly cmd: C
  readonly [x: string]: unknown
}

export type NEW = Command<Party.Recipient, "NEW"> & {readonly rcvPubKey: Uint8Array}
export type SUB = Command<Party.Recipient, "SUB">
export type KEY = Command<Party.Recipient, "KEY"> & {readonly sndPubKey: Uint8Array}
export type ACK = Command<Party.Recipient, "ACK">
export type OFF = Command<Party.Recipient, "OFF">
export type DEL = Command<Party.Recipient, "DEL">
export type SEND = Command<Party.Sender, "SEND"> & {readonly msgBody: Uint8Array}
export type PING = Command<Party.Sender, "PING">
export type IDS = Command<Party.Broker, "IDS"> & {readonly rcvId: Uint8Array; readonly sndId: Uint8Array}
export type MSG = Command<Party.Broker, "MSG"> & {readonly msgId: Uint8Array; readonly ts: Date; readonly msgBody: Uint8Array}
export type END = Command<Party.Broker, "END">
export type OK = Command<Party.Broker, "OK">
export type ERR<E extends ErrorType = ErrorType> = Command<Party.Broker, "ERR"> & {readonly error: SMPError<E>}
export type PONG = Command<Party.Broker, "PONG">

export type SMPError<E extends ErrorType = ErrorType> = E extends "CMD"
  ? {
      readonly eType: "CMD"
      readonly eSubType: CMDErrorType
    }
  : {readonly eType: E}

type ErrorSubType<E extends ErrorType = ErrorType> = E extends "CMD" ? CMDErrorType : undefined

export function smpError<E extends ErrorType>(eType: E, eSubType: ErrorSubType<E>): SMPError<E> {
  return (eType === "CMD" ? {eType, eSubType} : {eType}) as SMPError<E>
}

const smpErrors = ["BLOCK", "CMD", "AUTH", "NO_MSG", "INTERNAL"] as const

const errBytes: BinaryTags<typeof smpErrors[number]> = binaryTags(smpErrors)

type ErrorType = typeof smpErrors[number]

const smpCmdErrors = ["PROHIBITED", "KEY_SIZE", "SYNTAX", "NO_AUTH", "HAS_AUTH", "NO_QUEUE"] as const

const cmdErrBytes: BinaryTags<typeof smpCmdErrors[number]> = binaryTags(smpCmdErrors)

type CMDErrorType = typeof smpCmdErrors[number]

export type SMPCommand<P extends Party = Party, C extends CmdTag<P> = CmdTag<P>> = Command<P, C> &
  (NEW | SUB | KEY | ACK | OFF | DEL | SEND | PING | IDS | MSG | END | OK | ERR | PONG)

export type Client = Party.Recipient | Party.Sender

// command constructors
export const cNEW = (key: Uint8Array): NEW => ({cmd: "NEW", party: Party.Recipient, rcvPubKey: key})
export const cSUB = (): SUB => ({cmd: "SUB", party: Party.Recipient})
export const cKEY = (key: Uint8Array): KEY => ({cmd: "KEY", party: Party.Recipient, sndPubKey: key})
export const cACK = (): ACK => ({cmd: "ACK", party: Party.Recipient})
export const cOFF = (): OFF => ({cmd: "OFF", party: Party.Recipient})
export const cDEL = (): DEL => ({cmd: "DEL", party: Party.Recipient})
export const cSEND = (msg: Uint8Array): SEND => ({cmd: "SEND", party: Party.Sender, msgBody: msg})
export const cPING = (): PING => ({cmd: "PING", party: Party.Sender})
export const cIDS = (rcvId: Uint8Array, sndId: Uint8Array): IDS => ({cmd: "IDS", party: Party.Broker, rcvId, sndId})
export const cMSG = (msgId: Uint8Array, ts: Date, msgBody: Uint8Array): MSG => ({
  cmd: "MSG",
  party: Party.Broker,
  msgId,
  ts,
  msgBody,
})
export const cEND = (): END => ({cmd: "END", party: Party.Broker})
export const cOK = (): OK => ({cmd: "OK", party: Party.Broker})
export const cERR = <E extends ErrorType>(error: E, cmdError: ErrorSubType<E>): ERR<E> => ({
  cmd: "ERR",
  party: Party.Broker,
  error: smpError(error, cmdError),
})
export const cPONG = (): PONG => ({cmd: "PONG", party: Party.Broker})

export const cmdTagBytes: BinaryTags<CmdTag> = binaryTags(cmdTags)

function binaryTags<T extends string>(tags: readonly T[]): BinaryTags<T> {
  const res: Partial<BinaryTags<T>> = {}
  tags.forEach((tag) => (res[tag] = encodeAscii(tag)))
  return res as BinaryTags<T>
}

export function serializeSMPCommand(c: SMPCommand): Uint8Array {
  return c.cmd === "NEW"
    ? unwords(cmdTagBytes.NEW, serializePubKey(c.rcvPubKey))
    : c.cmd === "KEY"
    ? unwords(cmdTagBytes.KEY, serializePubKey(c.sndPubKey))
    : c.cmd === "SEND"
    ? unwordsN(cmdTagBytes.SEND, ...serializeMsg(c.msgBody))
    : c.cmd === "IDS"
    ? unwordsN(cmdTagBytes.IDS, encodeBase64(c.rcvId), encodeBase64(c.sndId))
    : c.cmd === "MSG"
    ? unwordsN(cmdTagBytes.MSG, encodeBase64(c.msgId), encodeAscii(c.ts.toISOString()), ...serializeMsg(c.msgBody))
    : c.cmd === "ERR"
    ? c.error.eType === "CMD"
      ? unwordsN(cmdTagBytes.ERR, errBytes.CMD, cmdErrBytes[c.error.eSubType])
      : unwords(cmdTagBytes.ERR, errBytes[c.error.eType])
    : cmdTagBytes[c.cmd]
}

function serializeMsg(msg: Uint8Array): Uint8Array[] {
  // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
  return [encodeAscii("" + msg.byteLength), msg, empty]
}

const rsaPrefix = new Uint8Array(encodeAscii("rsa:"))

function serializePubKey(rcvPubKey: Uint8Array): Uint8Array {
  return concat(rsaPrefix, encodeBase64(rcvPubKey))
}

export const smpCmdParsers: {
  readonly [T in CmdTag]: (p: Parser) => SMPCommand<Party, T> | undefined
} = {
  NEW: (p) => {
    let key: Uint8Array | undefined
    return p.space() && (key = pubKeyP(p)) && cNEW(key)
  },
  SUB: cSUB,
  KEY: (p) => {
    let key: Uint8Array | undefined
    return p.space() && (key = pubKeyP(p)) && cKEY(key)
  },
  ACK: cACK,
  OFF: cOFF,
  DEL: cDEL,
  SEND: (p) => {
    let msg: Uint8Array | undefined
    return p.space() && (msg = messageP(p)) && cSEND(msg)
  },
  PING: cPING,
  IDS: (p) => {
    let rId, sId: Uint8Array | undefined
    return p.space() && (rId = p.base64()) && p.space() && (sId = p.base64()) && cIDS(rId, sId)
  },
  MSG: (p) => {
    let msgId: Uint8Array | undefined
    let msg: Uint8Array | undefined
    let ts: Date | undefined
    return (
      p.space() &&
      (msgId = p.base64()) &&
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
    const err = p.space() && p.someStr(errBytes)
    let cmdErr: CMDErrorType | undefined
    return err === "CMD" ? p.space() && (cmdErr = p.someStr(cmdErrBytes)) && cERR("CMD", cmdErr) : err && cERR(err, undefined)
  },
  PONG: cPONG,
}

export function parseSMPCommand(s: Uint8Array): SMPCommand | undefined {
  const p = new Parser(s)
  const cmd = smpCommandP(p)
  return cmd && p.end() ? cmd : undefined
}

export function smpCommandP(p: Parser): SMPCommand | undefined {
  const cmd = p.someStr(cmdTagBytes)
  return cmd ? smpCmdParsers[cmd](p) : undefined
}

function pubKeyP(p: Parser): Uint8Array | undefined {
  return p.str(rsaPrefix) && p.base64()
}

function messageP(p: Parser): Uint8Array | undefined {
  let len: number | undefined
  let msg: Uint8Array | undefined
  if ((len = p.decimal()) && p.space() && (msg = p.take(len)) && p.space()) return msg
  return undefined
}
