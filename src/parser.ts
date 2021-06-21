import * as B from "./buffer"

export type ParserFunc<T> = (p?: Parser) => T | undefined

export type BinaryTags<T extends string> = {[K in T]: Uint8Array}

export class Parser {
  private readonly positions: number[] = []
  private pos = 0
  constructor(private readonly s: Uint8Array) {}

  try<T>(parser: ParserFunc<T>): T | undefined {
    this.positions.push(this.pos)
    const res = parser(this)
    const prevPos = this.positions.pop()
    if (res === undefined) this.pos = prevPos || 0
    return res || undefined
  }

  // takes a required number of bytes
  take(len: number): Uint8Array | undefined {
    const end = this.pos + len
    if (end > this.s.length) return undefined
    const res = this.s.subarray(this.pos, end)
    this.pos = end
    return res
  }

  // takes chars while condition is true, e.g. function isAlphaNum or isDigit can be used
  takeWhile(f: (c: number) => boolean): Uint8Array {
    return this.takeWhile1(f) || B.empty
  }

  // takes chars (> 0) while condition is true, e.g. function isAlphaNum or isDigit can be used
  takeWhile1(f: (c: number) => boolean): Uint8Array | undefined {
    const {pos} = this
    while (f(this.s[this.pos])) this.pos++
    return this.pos > pos ? this.s.subarray(pos, this.pos) : undefined
  }

  // takes base-64 encoded string and returns decoded binary
  base64(): Uint8Array | undefined {
    const {pos} = this
    let c: number
    while (((c = this.s[this.pos]), isAlphaNum(c) || c === char_plus || c === char_slash)) this.pos++
    if (this.char(B.char_equal)) this.char(B.char_equal)
    return this.pos > pos ? B.decodeBase64(this.s.subarray(pos, this.pos)) : undefined
  }

  many<T>(parser: ParserFunc<T>): T[] {
    let el: T | undefined
    const res: T[] = []
    while ((el = parser(this))) res.push(el)
    return res
  }

  many1<T>(parser: ParserFunc<T>): T[] | undefined {
    const res = this.many(parser)
    return res.length > 0 ? res : undefined
  }

  // takes the word (possibly empty) until the first space or until the end of the string
  word(range?: number): Uint8Array {
    const pos = range
      ? this.s.subarray(this.pos, this.pos + range).indexOf(B.space) + this.pos
      : this.s.indexOf(B.space, this.pos)
    let res: Uint8Array
    ;[res, this.pos] = pos >= this.pos ? [this.s.subarray(this.pos, pos), pos] : [this.s.subarray(this.pos), this.s.length]
    return res
  }

  // takes the passed string
  str(s: Uint8Array): true | undefined {
    for (let i = 0, j = this.pos; i < s.length; i++, j++) {
      if (s[i] !== this.s[j]) return undefined
    }
    this.pos += s.length
    return true
  }

  // takes the passed char
  char(c: number): true | undefined {
    if (this.s[this.pos] === c) {
      this.pos++
      return true
    }
    return
  }

  // takes one of the passed tags and returns the key
  someStr<T extends string>(ss: BinaryTags<T>): T | undefined {
    outer: for (const k in ss) {
      const s = new Uint8Array(ss[k])
      for (let i = 0, j = this.pos; i < s.length; i++, j++) {
        if (s[i] !== this.s[j]) continue outer
      }
      this.pos += s.length
      return k
    }
    return undefined
  }

  // takes decimal digits (at least 1) and returns a number
  decimal(): number | undefined {
    const s = this.takeWhile1(isDigit)
    if (s === undefined) return
    let n = 0
    for (let i = 0; i < s.length; i++) {
      n *= 10
      n += s[i] - char_0
    }
    return n
  }

  // takes ISO8601 date and returns as Date object
  date(): Date | undefined {
    const s = this.word()
    const d = s.length && new Date(B.decodeAscii(s))
    return d && !isNaN(d.valueOf()) ? d : undefined
  }

  // takes the space
  space(): true | undefined {
    return this.s[this.pos] === B.space ? ((this.pos += 1), true) : undefined
  }

  // returns true if string ended
  end(): true | undefined {
    return this.pos >= this.s.length || undefined
  }

  // returns unparsed part of the string
  rest(): Uint8Array {
    return this.s.subarray(this.pos)
  }
}

function cc(c: string): number {
  return c.charCodeAt(0)
}

const char_0 = cc("0")
const char_9 = cc("9")
const char_a = cc("a")
const char_z = cc("z")
const char_A = cc("A")
const char_Z = cc("Z")
const char_plus = cc("+")
const char_slash = cc("/")

export function isDigit(c: number): boolean {
  return c >= char_0 && c <= char_9
}

export function isAlphaNum(c: number): boolean {
  return (c >= char_0 && c <= char_9) || (c >= char_a && c <= char_z) || (c >= char_A && c <= char_Z)
}
