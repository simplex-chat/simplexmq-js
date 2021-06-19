import "./browser_globals"
import {serializeSMPCommand, parseSMPCommand, SMPCommand} from "../src/protocol"
import {encodeAscii} from "../src/buffer"
import * as SMP from "../src/protocol"
import * as assert from "assert"

describe("Parsing & serializing SMP commands", () => {
  test("NEW", parseSerialize(SMP.cNEW(encodeAscii("rsa:1234"))))
  test("SUB", parseSerialize(SMP.cSUB()))
  test("KEY", parseSerialize(SMP.cKEY(encodeAscii("rsa:1234"))))
  test("ACK", parseSerialize(SMP.cACK()))
  test("OFF", parseSerialize(SMP.cOFF()))
  test("DEL", parseSerialize(SMP.cDEL()))
  test("SEND", parseSerialize(SMP.cSEND(encodeAscii("hello"))))
  test("PING", parseSerialize(SMP.cPING()))
  test("IDS", parseSerialize(SMP.cIDS(encodeAscii("abc"), encodeAscii("def"))))
  test("MSG", parseSerialize(SMP.cMSG(encodeAscii("fgh"), new Date(), encodeAscii("hello"))))
  test("END", parseSerialize(SMP.cEND()))
  test("OK", parseSerialize(SMP.cOK()))
  test("ERR", parseSerialize(SMP.cERR("AUTH", undefined)))
  test("ERR CMD", parseSerialize(SMP.cERR("CMD", "SYNTAX")))
  test("PONG", parseSerialize(SMP.cPONG()))

  function parseSerialize(cmd: SMPCommand): () => void {
    return () => assert.deepStrictEqual(parseSMPCommand(serializeSMPCommand(cmd)), cmd)
  }
})
