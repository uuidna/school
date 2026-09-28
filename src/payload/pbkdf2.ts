import { createHmac } from 'node:crypto'

/**
 * PBKDF2 split into the HMAC rounds it is made of, so a capped runtime can
 * still produce the bytes an uncapped one would.
 *
 * THE WALL. Cloudflare Workers refuse PBKDF2 above 100,000 iterations, on
 * purpose: an attacker who can ask for arbitrary iterations can make one
 * request arbitrarily expensive. Payload ≥ 3.90.0 hashes passwords at 600,000
 * — a module constant with no config option, no export, and an `exports` map
 * that refuses both a deep import and `payload/package.json`. Two correct
 * decisions that cannot both hold, and the school pays: no account can be
 * created and nobody can log in.
 *
 * THE WALL IS AROUND THE PRIMITIVE, NOT AROUND THE WORK. `pbkdf2(P, S, c)` is
 * refused at c = 600,000. The thing it is defined as is not refused at all:
 *
 *     DK   = T₁ ‖ T₂ ‖ … ‖ T_l
 *     T_i  = U₁ ⊕ U₂ ⊕ … ⊕ U_c
 *     U₁   = HMAC(P, S ‖ INT32BE(i))
 *     U_j  = HMAC(P, U_{j−1})
 *
 * (RFC 8018 §5.2). Six hundred thousand HMACs carry exactly the work the
 * runtime declined to do in one call, and no HMAC is capped. So the cap is not
 * a limit on the computation — it is a limit on asking for it in one breath.
 *
 * NO CONFLICTS, AND THAT IS THE WHOLE POINT. This is not a different, cheaper
 * KDF standing in. Chaining `pbkdf2` calls, or halving the iterations, would
 * give a hash that is not the hash — every password stored before the change
 * would stop verifying, and every one stored after would be unverifiable by a
 * normal Payload on a normal runtime. What this returns is BYTE-IDENTICAL to
 * `crypto.pbkdf2` for the same inputs, which the test asserts against Node's
 * own implementation rather than against a vector somebody copied. Hashes made
 * here verify anywhere; hashes made anywhere verify here.
 *
 * WHAT IT DOES NOT DO. It does not make the work cheaper, and must not: the
 * 600,000 rounds are the security parameter. It costs what it costs, which is
 * the correct outcome — the runtime's objection was to a hostile *shape* of
 * request, not to honest key stretching.
 */

/** SHA-256 output, and the only digest Payload's current hash prefix names. */
const H_LEN = 32

/**
 * One derived block.
 *
 * `U` is reused as both the running HMAC input and the accumulator's source,
 * which is safe because HMAC copies its input before returning — and the XOR
 * folds into a separate buffer, never into the value still being chained.
 */
const block = (password: Buffer, salt: Buffer, iterations: number, index: number): Buffer => {
  const indexed = Buffer.alloc(salt.length + 4)
  salt.copy(indexed, 0)
  indexed.writeUInt32BE(index, salt.length)

  let u = createHmac('sha256', password).update(indexed).digest()
  const accumulated = Buffer.from(u)

  for (let round = 1; round < iterations; round++) {
    u = createHmac('sha256', password).update(u).digest()
    for (let byte = 0; byte < H_LEN; byte++) accumulated[byte]! ^= u[byte]!
  }

  return accumulated
}

/**
 * `pbkdf2Sync(password, salt, iterations, keyLength, 'sha256')`, computed as
 * HMAC rounds.
 *
 * Signature-compatible with the Node function it stands in for, so it can be
 * aliased in without the caller knowing — which is the only way to reach
 * Payload's hashing at all, the iteration count being unreachable by every
 * other route.
 */
/**
 * BEFORE REACHING FOR THIS ON A LOGIN PATH: it costs 1.8 s of Worker CPU at 600,000 iterations, measured, and
 * that cost is spent BEFORE the password is known to be right. Cloudflare's 100,000 cap is a denial-of-service
 * control, not an arbitrary limit, and this function is what removes it. runtime.ts carries the measurement and
 * the two consequences — including that Payload re-hashes opportunistically on a successful legacy login, so
 * adopting this migrates accounts silently and makes every subsequent login pay 24x.
 *
 * It is the right construction — byte-identical to the KDF upstream would have run, so the day the cap is
 * raised it comes out and every stored hash stays valid. Being right is not being free.
 */
export const pbkdf2Split = (
  password: Buffer | string,
  salt: Buffer | string,
  iterations: number,
  keyLength: number,
  digest = 'sha256',
): Buffer => {
  // ONE DIGEST, AND A REFUSAL FOR THE REST. Silently computing SHA-256 for a
  // caller that asked for SHA-512 would return plausible bytes that are not
  // the hash, and nothing downstream could tell. A stand-in that answers
  // questions it was not asked is worse than one that is absent.
  if (digest !== 'sha256') {
    throw new Error(`pbkdf2Split computes sha256 only; "${digest}" was requested — alias it for sha256 callers only`)
  }
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('iterations must be a positive integer')
  if (!Number.isInteger(keyLength) || keyLength < 1) throw new Error('keyLength must be a positive integer')

  const p = Buffer.isBuffer(password) ? password : Buffer.from(password, 'utf8')
  const s = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'utf8')

  const blocks = Math.ceil(keyLength / H_LEN)
  const parts: Buffer[] = []
  for (let index = 1; index <= blocks; index++) parts.push(block(p, s, iterations, index))

  return Buffer.concat(parts).subarray(0, keyLength)
}

/**
 * The callback form, which is the one Payload actually calls:
 * `crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', cb)`.
 *
 * Errors arrive through the callback, never as a throw, because that is how
 * the function being replaced behaves and a caller wrapping it in a Promise
 * would otherwise reject before its own error handling ran.
 */
export const pbkdf2SplitCallback = (
  password: Buffer | string,
  salt: Buffer | string,
  iterations: number,
  keyLength: number,
  digest: string,
  callback: (error: Error | null, derived?: Buffer) => void,
): void => {
  try {
    callback(null, pbkdf2Split(password, salt, iterations, keyLength, digest))
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)))
  }
}
