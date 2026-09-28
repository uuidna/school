import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PBKDF2_CURRENT, PBKDF2_LEGACY, checkRuntime, pbkdf2Ceiling } from './runtime.js'

test('the ceiling is MEASURED — on a host that allows 600,000 it says so', async () => {
  const ceiling = await pbkdf2Ceiling()
  assert.equal(ceiling, PBKDF2_CURRENT, 'Node enforces no PBKDF2 ceiling, so the probe must reach the top count')

  const finding = await checkRuntime()
  assert.equal(finding.satisfied, true)
  assert.equal(finding.required, PBKDF2_CURRENT)
  assert.match(finding.reason, /succeeds here/)
})

// THE LOCAL PASS IS THE TRAP, NOT THE PROOF. The ceiling this guard exists for is
// enforced in production only: Node, miniflare and `wrangler dev` all accept
// 600,000, so every local run is green on a runtime that will refuse in the
// field. A test that only ever saw this host would therefore certify nothing.
// The refusing runtime is stood up here instead.
const withCappedSubtle = async <T>(cap: number, run: () => Promise<T>): Promise<T> => {
  const real = globalThis.crypto
  const subtle = {
    deriveBits: async (algorithm: { iterations: number }, ...rest: unknown[]) => {
      if (algorithm.iterations > cap) {
        throw new Error(`Pbkdf2 failed: iteration counts above ${cap} are not supported (requested ${algorithm.iterations})`)
      }
      return (real.subtle.deriveBits as (...a: unknown[]) => Promise<ArrayBuffer>)(algorithm, ...rest)
    },
    importKey: real.subtle.importKey.bind(real.subtle),
  }
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { ...real, subtle } })
  try {
    return await run()
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real })
  }
}

test('a runtime capped at 100,000 is reported UNSATISFIED, with the pin that fixes it', async () => {
  const finding = await withCappedSubtle(100_000, checkRuntime)

  assert.equal(finding.ceiling, 100_000, 'the probe must stop at the cap, not report the count it wanted')
  assert.equal(finding.satisfied, false, 'a runtime that cannot hash a password cannot authenticate anybody')
  assert.match(finding.reason, />=3 <3\.90\.0/, 'an unmet requirement must carry its remedy')
  assert.match(finding.reason, /every login fails|Every account creation/)
})

test('the walk stops at the first refusal rather than skipping past it', async () => {
  assert.equal(await withCappedSubtle(PBKDF2_LEGACY, pbkdf2Ceiling), PBKDF2_LEGACY)
  assert.equal(await withCappedSubtle(PBKDF2_LEGACY - 1, pbkdf2Ceiling), 0, 'below the lowest probe the ceiling is zero, not the lowest probe')
})

// AND IT FAILS SAFE, which is the whole reason the walk stops rather than
// skipping. The mutation battery caught this: swapping `break` for `continue`
// changed nothing any test could see, because a real ceiling is monotone — every
// probe above it refuses too, so both spellings land on the same number. The
// case they differ on is a refusal that is NOT the ceiling: a transient error, a
// runtime that throws for its own reasons at one width. `continue` would then
// report support for a count it never derived contiguously, and a host would
// deploy on it. `break` under-reports instead, and an under-report only ever
// sends someone to pin a version they did not have to. That asymmetry is the
// property, so here is the runtime that tells the two apart.
const refusingOnly = async <T>(refuse: number, run: () => Promise<T>): Promise<T> => {
  const real = globalThis.crypto
  const subtle = {
    deriveBits: async (algorithm: { iterations: number }, ...rest: unknown[]) => {
      if (algorithm.iterations === refuse) throw new Error('transient')
      return (real.subtle.deriveBits as (...a: unknown[]) => Promise<ArrayBuffer>)(algorithm, ...rest)
    },
    importKey: real.subtle.importKey.bind(real.subtle),
  }
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { ...real, subtle } })
  try {
    return await run()
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real })
  }
}

test('a refusal that is not the ceiling stops the walk — it never reports a width it skipped', async () => {
  assert.equal(await refusingOnly(100_000, pbkdf2Ceiling), PBKDF2_LEGACY,
    'walking past the refusal would claim 600,000 on a runtime that refused 100,000')

  const finding = await refusingOnly(100_000, checkRuntime)
  assert.equal(finding.satisfied, false, 'under-reporting sends a host to pin; over-reporting sends it to production')
})

test('no PBKDF2 at all is a ceiling of zero, not a throw at a booting host', async () => {
  const real = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
  try {
    const finding = await checkRuntime()
    assert.equal(finding.ceiling, 0)
    assert.equal(finding.satisfied, false)
    assert.match(finding.reason, /no PBKDF2 key at all/)
  } finally {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real })
  }
})
