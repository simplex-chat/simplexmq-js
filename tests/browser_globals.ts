export function atob(s: string): string {
  return Buffer.from(s, "base64").toString()
}

Object.defineProperty(global, "atob", {value: atob})

export function btoa(s: string): string {
  return Buffer.from(s).toString("base64")
}

Object.defineProperty(global, "btoa", {value: btoa})
