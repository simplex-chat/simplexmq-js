export default class Parser {
  private readonly positions: number[] = []
  private pos = 0
  constructor(private readonly s: string) {}

  try(): Parser {
    this.positions.push(this.pos)
    return this
  }

  back(): Parser {
    if (this.positions.length === 0) throw new Error("back called without call to try")
    this.pos = this.positions.pop() || 0
    return this
  }

  retry(): Parser {
    return this.back().try()
  }

  // takes the word (possibly empty) until the first space or until the end of string
  word(range?: number): string {
    const pos = (range ? this.s.slice(this.pos, range) : this.s).indexOf(" ")
    let res: string
    ;[res, this.pos] =
      pos >= 0 ? [this.s.slice(this.pos, this.pos + pos), this.pos + pos] : [this.s, this.s.length]
    return res
  }

  // takes the passed string
  str(s: string): boolean {
    return this.s.indexOf(s, this.pos) === 0 ? ((this.pos += s.length), true) : false
  }

  // takes one of the passed strings
  someStr(ss: string[]): string | undefined {
    for (const s of ss) {
      if (this.s.indexOf(s, this.pos) === 0) {
        this.pos += s.length
        return s
      }
    }
    return undefined
  }

  // takes the space
  space(): boolean {
    return this.s[this.pos] === " " ? ((this.pos += 1), true) : false
  }

  // returns true if string ended
  end(): boolean {
    return this.pos >= this.s.length
  }
}
