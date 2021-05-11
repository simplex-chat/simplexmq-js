export type ParserFunc<T> = (p?: Parser) => T | "" | undefined

export class Parser {
  private readonly positions: number[] = []
  private pos = 0
  constructor(private readonly s: string) {}

  try<T>(parser: ParserFunc<T>): T | undefined {
    this.positions.push(this.pos)
    const res = parser(this)
    const prevPos = this.positions.pop()
    if (res === undefined) this.pos = prevPos || 0
    return res || undefined
  }

  // takes a required number of bytes
  take(len: number): string | undefined {
    const len1 = this.pos + len
    if (len1 > this.s.length) return undefined
    const res = this.s.slice(this.pos, len1)
    this.pos = len1
    return res
  }

  // takes chars while condition is true, e.g. function isAlphaNum or isDigit can be used
  takeWhile(f: (s: string) => boolean): string {
    const {pos} = this
    while (f(this.s[this.pos])) this.pos++
    return this.pos > pos ? this.s.slice(pos, this.pos) : ""
  }

  // takes chars (> 0) while condition is true, e.g. function isAlphaNum or isDigit can be used
  takeWhile1(f: (s: string) => boolean): string | undefined {
    return this.takeWhile(f) || undefined
  }

  // takes specific characters
  takeWhileChar(c: string): string {
    const {pos} = this
    while (this.s[this.pos] === c) this.pos++
    return this.pos > pos ? this.s.slice(pos, this.pos) : ""
  }

  many<T>(parser: ParserFunc<T>): T[] {
    let el: T | "" | undefined
    const res: T[] = []
    while ((el = parser(this))) res.push(el)
    return res
  }

  many1<T>(parser: ParserFunc<T>): T[] | undefined {
    const res = this.many(parser)
    return res.length > 0 ? res : undefined
  }

  // takes the word (possibly empty) until the first space or until the end of the string
  word(range?: number): string {
    const pos = range ? this.s.slice(this.pos, this.pos + range).indexOf(" ") + this.pos : this.s.indexOf(" ", this.pos)
    let res: string
    ;[res, this.pos] = pos >= this.pos ? [this.s.slice(this.pos, pos), pos] : [this.s.slice(this.pos), this.s.length]
    return res
  }

  // takes the passed string
  str(s: string): true | undefined {
    return this.s.indexOf(s, this.pos) === this.pos ? ((this.pos += s.length), true) : undefined
  }

  // takes one of the passed strings
  someStr<T extends readonly string[]>(ss: T): T[number] | undefined {
    for (const s of ss) {
      if (this.s.indexOf(s, this.pos) === this.pos) {
        this.pos += s.length
        return s
      }
    }
    return undefined
  }

  // takes decimal digits (at least 1)
  decimal(): number | undefined {
    const s = this.takeWhile1(isDigit)
    return s ? +s : undefined
  }

  // takes ISO8601 date and returns as Date object
  date(): Date | undefined {
    const s = this.word()
    const d = s && new Date(s)
    return d && !isNaN(d.valueOf()) ? d : undefined
  }

  // takes the space
  space(): true | undefined {
    return this.s[this.pos] === " " ? ((this.pos += 1), true) : undefined
  }

  // returns true if string ended
  end(): true | undefined {
    return this.pos >= this.s.length || undefined
  }

  // returns unparsed part of the string
  rest(): string {
    return this.s.slice(this.pos)
  }
}

export function isDigit(c: string): boolean {
  return c >= "0" && c <= "9"
}

export function isAlphaNum(c: string): boolean {
  return (c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
}
