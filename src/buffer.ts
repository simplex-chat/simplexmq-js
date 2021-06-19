export function concat(b1: Uint8Array, b2: Uint8Array): Uint8Array {
  const a = new Uint8Array(b1.byteLength + b2.byteLength)
  a.set(b1, 0)
  a.set(b2, b1.byteLength)
  return a
}

export function concatN(...bs: Uint8Array[]): Uint8Array {
  const a = new Uint8Array(bs.reduce((size, b) => size + b.byteLength, 0))
  bs.reduce((offset, b: Uint8Array) => {
    a.set(b, offset)
    return offset + b.byteLength
  }, 0)
  return a
}

export const space = " ".charCodeAt(0)
export const char_equal = "=".charCodeAt(0)

export function unwords(b1: Uint8Array, b2: Uint8Array): Uint8Array {
  const a = new Uint8Array(b1.byteLength + b2.byteLength + 1)
  a.set(b1, 0)
  a[b1.byteLength] = space
  a.set(b2, b1.byteLength + 1)
  return a
}

export function unwordsN(...bs: Uint8Array[]): Uint8Array {
  let i = bs.length
  let size = bs.length - 1
  while (i--) size += bs[i].byteLength
  const a = new Uint8Array(size)

  let offset = 0
  for (i = 0; i < bs.length - 1; i++) {
    const b = bs[i]
    a.set(b, offset)
    offset += b.byteLength
    a[offset++] = space
  }
  a.set(bs[i], offset)
  return a
}

export function encodeInt32(n: number): Uint8Array {
  const res = new Uint8Array(4)
  new DataView(res.buffer).setUint32(0, n)
  return res
}

export function encodeInt16(n: number): Uint8Array {
  const res = new Uint8Array(2)
  new DataView(res.buffer).setUint16(0, n)
  return res
}

// characters that are bigger than one byte will be truncated
export function encodeAscii(s: string): Uint8Array {
  const a = new Uint8Array(s.length)
  let i = s.length
  while (i--) a[i] = s.charCodeAt(i)
  return a
}

export function decodeAscii(a: Uint8Array): string {
  let s = ""
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i])
  return s
}

const base64chars = new Uint8Array(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").map((c) => c.charCodeAt(0))
)

const base64lookup = new Array(256) as (number | undefined)[]
base64chars.forEach((c, i) => (base64lookup[c] = i))

export function encodeBase64(a: Uint8Array): Uint8Array {
  const len = a.length
  const b64len = Math.ceil(len / 3) * 4
  const b64 = new Uint8Array(b64len)

  let j = 0
  for (let i = 0; i < len; i += 3) {
    b64[j++] = base64chars[a[i] >> 2]
    b64[j++] = base64chars[((a[i] & 3) << 4) | (a[i + 1] >> 4)]
    b64[j++] = base64chars[((a[i + 1] & 15) << 2) | (a[i + 2] >> 6)]
    b64[j++] = base64chars[a[i + 2] & 63]
  }

  if (len % 3) b64[b64len - 1] = char_equal
  if (len % 3 === 1) b64[b64len - 2] = char_equal

  return b64
}

export function decodeBase64(b64: Uint8Array): Uint8Array | undefined {
  let len = b64.length
  if (len % 4) return
  let bLen = (len * 3) / 4

  if (b64[len - 1] === char_equal) {
    len--
    bLen--
    if (b64[len - 1] === char_equal) {
      len--
      bLen--
    }
  }

  const bytes = new Uint8Array(bLen)

  let i = 0
  let pos = 0
  while (i < len) {
    const enc1 = base64lookup[b64[i++]]
    const enc2 = i < len ? base64lookup[b64[i++]] : 0
    const enc3 = i < len ? base64lookup[b64[i++]] : 0
    const enc4 = i < len ? base64lookup[b64[i++]] : 0
    if (enc1 === undefined || enc2 === undefined || enc3 === undefined || enc4 === undefined) return
    bytes[pos++] = (enc1 << 2) | (enc2 >> 4)
    bytes[pos++] = ((enc2 & 15) << 4) | (enc3 >> 2)
    bytes[pos++] = ((enc3 & 3) << 6) | (enc4 & 63)
  }

  return bytes
}
