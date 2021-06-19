import {decodeAscii, encodeAscii, decodeBase64, encodeBase64} from "../src/buffer"
import * as assert from "assert"

describe("ArrayBuffer utility functions", () => {
  describe("ASCII encoding/decoding", () => {
    const hello123 = new Uint8Array([104, 101, 108, 108, 111, 49, 50, 51])

    test("encodeAscii", () => {
      assert.deepStrictEqual(encodeAscii("hello123"), hello123)
    })

    test("decodeAscii", () => {
      assert.deepStrictEqual(decodeAscii(hello123), "hello123")
    })
  })

  describe("base-64 encoding/decoding", () => {
    const base64tests = [
      {binary: "\x12\x34\x56\x78", base64: "EjRWeA=="},
      {binary: "hello123", base64: "aGVsbG8xMjM="},
      {binary: "Hello world", base64: "SGVsbG8gd29ybGQ="},
      {binary: "Hello worlds!", base64: "SGVsbG8gd29ybGRzIQ=="},
      {binary: "May", base64: "TWF5"},
      {binary: "Ma", base64: "TWE="},
      {binary: "M", base64: "TQ=="},
      {
        description: "all binary chars",
        binary: allBinaryChars(),
        base64:
          "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==",
      },
    ]

    base64tests.forEach(({description, binary, base64}) => {
      describe(`testing ${description || binary}`, () => {
        test("encodeBase64", () => {
          assert.deepStrictEqual(encodeBase64(encodeAscii(binary)), encodeAscii(base64))
        })

        test("decodeBase64", () => {
          assert.deepStrictEqual(decodeBase64(encodeAscii(base64)), encodeAscii(binary))
        })
      })
    })

    function allBinaryChars(): string {
      const a = new Uint8Array(256)
      for (let i = 0; i < 256; i++) a[i] = i
      return decodeAscii(a)
    }
  })
})
