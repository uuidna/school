/**
 * The hashing primitives the fair-selection code is built on, stated once.
 *
 * `toHex`, `sha256` and `canonical` had grown a copy each in `draw.ts`,
 * `chain.ts` and `merkle.ts`. The copies agreed, which is the only reason
 * nothing had broken — and it is not a property anybody was checking. A
 * receipt's content address, the chain link that commits to it, and the Merkle
 * leaf that seals it are three hashes that must be computed the same way by
 * three modules. One edit to one copy and a chain verifies against receipts it
 * no longer matches, arithmetically, with nothing reporting a fault.
 *
 * Written against Web Crypto so the same code runs in Workers, in Next.js
 * route handlers, and in Node.
 */

const encoder = new TextEncoder()

export const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

export const fromHex = (hex: string): Uint8Array => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) {
    throw new Error(`Not a hex string: ${hex}`)
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** SHA-256 of a string, hex encoded. */
export const sha256 = async (text: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))

/**
 * SHA-256 over concatenated byte runs, hex encoded.
 *
 * Separate from `sha256` because the Merkle tree hashes a domain-separation
 * prefix byte together with raw digests, and routing that through a string
 * would change what is hashed.
 */
export const sha256Bytes = async (...parts: Uint8Array[]): Promise<string> => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return toHex(await crypto.subtle.digest('SHA-256', joined))
}

/**
 * Unambiguous join: every part carries its own byte length, so no choice of
 * delimiter inside a part can forge a different part list.
 */
export const canonical = (parts: (number | string)[]): string =>
  parts
    .map((part) => {
      const text = String(part)
      return `${encoder.encode(text).length}:${text}`
    })
    .join('|')

/**
 * JSON with every key in sorted order, at every depth.
 *
 * `contentAddressOf` sorts one level, which is all a receipt needs — its
 * fields are flat. A financing programme is not: its criteria are objects
 * inside an array, and two copies of the same programme that differ only in
 * the order a database happened to return their keys would hash differently
 * and be reported as altered. Deliberately NOT used to replace the receipt's
 * one-level sort: changing how a receipt is addressed would invalidate every
 * receipt already published.
 *
 * Arrays keep their order, because order is content — a criteria list read
 * back in a different sequence is a different record and should say so.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`
}

export const importHmacKey = (key: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(key), { hash: 'SHA-256', name: 'HMAC' }, false, [
    'sign',
  ])

/**
 * HMAC-SHA256 as raw bytes.
 *
 * The uint32 stream reads the digest four bytes at a time, so it needs the
 * bytes rather than their hex. Kept here with the others so `crypto.subtle`
 * appears in one file and what gets hashed is reviewable in one place.
 */
export const hmacBytes = async (key: CryptoKey, message: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))

export const hmacSha256 = async (key: string, message: string): Promise<string> =>
  toHex(await crypto.subtle.sign('HMAC', await importHmacKey(key), encoder.encode(message)))

export { encoder }
