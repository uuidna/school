import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { test } from 'node:test'

import { pbkdf2Split, pbkdf2SplitCallback } from './pbkdf2.js'

/**
 * BYTE-IDENTITY AGAINST NODE'S OWN, not against a vector somebody copied.
 * A published test vector proves the implementation matches a document; this
 * proves it matches the function it is standing in for, which is the claim
 * that actually has to hold — a hash made here must verify on a normal
 * Payload, on a normal runtime, forever.
 */
const CASES: [string, string, number, number][] = [
  ['correct horse battery staple', 'salt', 1, 32],
  ['correct horse battery staple', 'salt', 2, 32],
  ['p', 's', 1000, 32],
  // Payload's own shape: 32-byte salt, 32-byte key.
  ['Парола на родител', 'a'.repeat(32), 4096, 32],
  // keyLength beyond one SHA-256 block, so the block loop and its index are exercised
  ['p', 's', 17, 64],
  ['p', 's', 17, 100],
  // Payload ≤ 3.89.0 asks for 512 bytes — sixteen blocks
  ['p', 's', 64, 512],
  ['', '', 3, 32],
]

test('every case is byte-identical to node:crypto pbkdf2', () => {
  for (const [password, salt, iterations, keyLength] of CASES) {
    assert.deepEqual(
      pbkdf2Split(password, salt, iterations, keyLength),
      pbkdf2Sync(password, salt, iterations, keyLength, 'sha256'),
      `differs at (${JSON.stringify(password)}, ${JSON.stringify(salt)}, ${iterations}, ${keyLength})`,
    )
  }
})

test('Buffer and string inputs agree, as they do for the function it replaces', () => {
  assert.deepEqual(
    pbkdf2Split(Buffer.from('p', 'utf8'), Buffer.from('s', 'utf8'), 100, 32),
    pbkdf2Sync('p', 's', 100, 32, 'sha256'),
  )
})

// THE CASE THE WHOLE FILE EXISTS FOR. Above a runtime's cap the primitive is
// refused and this is not, so the only check that matters is that the bytes are
// still right there. Node has no cap, so it can answer for the comparison.
test('above the Workers ceiling, where the primitive would be refused', () => {
  const ABOVE_CAP = 100_001
  assert.deepEqual(
    pbkdf2Split('parent@school.bg', 'b'.repeat(32), ABOVE_CAP, 32),
    pbkdf2Sync('parent@school.bg', 'b'.repeat(32), ABOVE_CAP, 32, 'sha256'),
  )
})

// THE CONTROL. A comparison that cannot fail proves nothing, and this package
// has shipped two of those.
test('the comparison can fail — one iteration out is a different hash', () => {
  assert.notDeepEqual(
    pbkdf2Split('p', 's', 1000, 32),
    pbkdf2Sync('p', 's', 1001, 32, 'sha256'),
  )
  assert.notDeepEqual(
    pbkdf2Split('p', 's', 1000, 32),
    pbkdf2Sync('p', 't', 1000, 32, 'sha256'),
  )
})

test('a digest it cannot compute is refused, never silently answered in sha256', () => {
  // Returning plausible bytes for a question nobody asked is how a stand-in
  // becomes undetectable.
  assert.throws(() => pbkdf2Split('p', 's', 10, 32, 'sha512'), /sha256 only/)
})

test('invalid parameters are refused rather than folded into a guess', () => {
  assert.throws(() => pbkdf2Split('p', 's', 0, 32), /positive integer/)
  assert.throws(() => pbkdf2Split('p', 's', 10, 0), /positive integer/)
})

test('the callback form reports errors through the callback, never by throwing', () => {
  // Payload wraps this in a Promise; a throw would reject before its own
  // error handling ran, which is not how the function it replaces behaves.
  let seen: Error | null = null
  let derived: Buffer | undefined
  pbkdf2SplitCallback('p', 's', 10, 32, 'sha256', (error, value) => { seen = error; derived = value })
  assert.equal(seen, null)
  assert.deepEqual(derived, pbkdf2Sync('p', 's', 10, 32, 'sha256'))

  let failure: Error | null = null
  pbkdf2SplitCallback('p', 's', 10, 32, 'sha512', (error) => { failure = error })
  assert.match(String(failure), /sha256 only/)
})
