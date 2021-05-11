export type ParserFunc<T> = (p?: Parser) => T | "" | false | undefined

export class Parser {
  private readonly positions: number[] = []
  private pos = 0
  constructor(private readonly s: string) {}

  try<T>(parser: ParserFunc<T>): T | undefined {
    this.positions.push(this.pos)
    const res = parser(this)
    const prevPos = this.positions.pop()
    if (res === undefined || res === false) this.pos = prevPos || 0
    return res || undefined
  }

  // TODO bytes rather than chars
  // takes a required number of bytes
  take(len: number): string | undefined {
    const len1 = this.pos + len
    if (len1 > this.s.length) return undefined
    const res = this.s.slice(this.pos, len1)
    this.pos = len1
    return res
  }

  // takes the word (possibly empty) until the first space or until the end of the string
  word(range?: number): string {
    const pos = range ? this.s.slice(this.pos, this.pos + range).indexOf(" ") + this.pos : this.s.indexOf(" ", this.pos)
    let res: string
    ;[res, this.pos] = pos >= this.pos ? [this.s.slice(this.pos, pos), pos] : [this.s.slice(this.pos), this.s.length]
    return res
  }

  // takes the passed string
  str(s: string): boolean {
    return this.s.indexOf(s, this.pos) === this.pos ? ((this.pos += s.length), true) : false
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
    const {pos} = this
    while (this.digit());
    return this.pos > pos ? +this.s.slice(pos, this.pos) : undefined
  }

  // takes exactly 1 decimal digit
  digit(): string | undefined {
    const c = this.s[this.pos]
    return c >= "0" && c <= "9" ? (this.pos++, c) : undefined
  }

  // takes ISO8601 date and returns as Date object
  date(): Date | undefined {
    const s = this.word()
    const d = s && new Date(s)
    return d && !isNaN(d.valueOf()) ? d : undefined
  }

  // takes the space
  space(): boolean {
    return this.s[this.pos] === " " ? ((this.pos += 1), true) : false
  }

  // returns true if string ended
  end(): boolean {
    return this.pos >= this.s.length
  }

  // returns unparsed part of the string
  rest(): string {
    return this.s.slice(this.pos)
  }
}
