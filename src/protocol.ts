import Parser from "./parser"

enum Party {
  Recipient = "R",
  Sender = "S",
  Broker = "B",
}

type RecipientCmdTag = "NEW" | "SUB" | "KEY" | "ACK" | "OFF" | "DEL"

type SenderCmdTag = "SEND" | "PING"

type BrokerCmdTag = "IDS" | "MSG" | "END" | "OK" | "ERR" | "PONG"

type CmdTag<P extends Party> = P extends Party.Recipient
  ? RecipientCmdTag
  : P extends Party.Sender
  ? SenderCmdTag
  : BrokerCmdTag

interface Command<P extends Party, C extends CmdTag<P>> {
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
type ERRParams = {error: Exclude<ErrorType, "CMD">} | {error: "CMD"; cmdError: CMDError}
type ERR = Command<Party.Broker, "ERR"> & ERRParams
type PONG = Command<Party.Broker, "PONG">

type ErrorType = "BLOCK" | "CMD" | "AUTH" | "NO_MSG" | "INTERNAL"

type CMDError = "PROHIBITED" | "KEY_SIZE" | "SYNTAX" | "NO_AUTH" | "HAS_AUTH" | "NO_QUEUE"

export type SMPCommand =
  | NEW
  | SUB
  | KEY
  | ACK
  | OFF
  | DEL
  | SEND
  | PING
  | IDS
  | MSG
  | END
  | OK
  | ERR
  | PONG

export function serializeSMPCommand(c: SMPCommand): string {
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
    ? `ERR ${serializeError(c)}`
    : c.cmd
}

function serializeMsg(msg: string): string {
  return `${byteLength(msg)} ${msg} ` // the trailing space is required
}

function serializeError(c: ERR): string {
  return c.error === "CMD" ? `CMD ${c.cmdError}` : c.error
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

export function smpCommandP(p: Parser): string | SMPCommand {
  let key, rcvId, sndId: string
  return p.try().str("NEW ") && (key = pubKeyP(p))
    ? {cmd: "NEW", party: Party.Recipient, rcvPubKey: key}
    : p.retry().str("KEY ") && (key = pubKeyP(p))
    ? {cmd: "KEY", party: Party.Recipient, sndPubKey: key}
    : p.retry().str("SUB")
    ? {cmd: "SUB", party: Party.Recipient}
    : p.str("ACK")
    ? {cmd: "ACK", party: Party.Recipient}
    : p.str("OFF")
    ? {cmd: "OFF", party: Party.Recipient}
    : p.str("DEL")
    ? {cmd: "DEL", party: Party.Recipient}
    : p.str("PING")
    ? {cmd: "PING", party: Party.Sender}
    : p.retry().str("IDS ") && (rcvId = base64P(p)) && p.space() && (sndId = base64P(p))
    ? {cmd: "IDS", party: Party.Broker, rcvId, sndId}
    : p.str("END")
    ? {cmd: "END", party: Party.Broker}
    : p.str("OK")
    ? {cmd: "OK", party: Party.Broker}
    : p.str("PONG")
    ? {cmd: "PONG", party: Party.Broker}
    : (p.back(), "invalid command syntax")
  // TODO SEND
  // TODO MSG
  // TODO ERR
}

// TODO stub
function pubKeyP(s: Parser): string {
  return s.word()
}

// TODO stub
function base64P(s: Parser): string {
  return s.word()
}
