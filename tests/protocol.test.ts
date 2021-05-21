import "./browser_globals"
import {serializeSMPCommand, parseSMPCommand, SMPCommand} from "../src/protocol"
import * as SMP from "../src/protocol"
import * as assert from "assert"

describe("Parsing & serializing SMP commands", () => {
  test("NEW", parseSerialize(SMP.cNEW("rsa:1234")))
  test("SUB", parseSerialize(SMP.cSUB()))
  test("KEY", parseSerialize(SMP.cKEY("rsa:1234")))
  test("ACK", parseSerialize(SMP.cACK()))
  test("OFF", parseSerialize(SMP.cOFF()))
  test("DEL", parseSerialize(SMP.cDEL()))
  test("SEND", parseSerialize(SMP.cSEND("hello")))
  test("PING", parseSerialize(SMP.cPING()))
  test("IDS", parseSerialize(SMP.cIDS("abc", "def")))
  test("MSG", parseSerialize(SMP.cMSG("fgh", new Date(), "hello")))
  test("END", parseSerialize(SMP.cEND()))
  test("OK", parseSerialize(SMP.cOK()))
  test("ERR", parseSerialize(SMP.cERR("AUTH", undefined)))
  test("ERR CMD", parseSerialize(SMP.cERR("CMD", "SYNTAX")))
  test("PONG", parseSerialize(SMP.cPONG()))

  function parseSerialize(cmd: SMPCommand): () => void {
    return () => {
      const s = serializeSMPCommand(cmd)
      assert.deepStrictEqual(parseSMPCommand(s), cmd)
    }
  }
})
