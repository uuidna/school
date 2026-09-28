import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canonical,
  contentAddressOf,
  getUnbiasedInt,
  pickWeighted,
  rosterHashOf,
  verifyResult,
} from './draw.js'

// THESE ARE FORGERIES THAT ONCE VERIFIED. Each test below builds a receipt an
// operator could have written to change who won, and asserts it is refused. A
// "provably fair" draw whose verifier accepts a doctored receipt is not a weaker
// guarantee than none — it is a false one, because it produces a document an
// auditor is entitled to believe.

const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `pupil${i}`, weight: 1 }))
const SEED = 'server-seed-abc'

/** Re-seals a doctored receipt so only the property under test is wrong. */
const reseal = async (result: Awaited<ReturnType<typeof pickWeighted>>) => {
  const { contentAddress: _drop, ...base } = result.receipt
  result.receipt.contentAddress = await contentAddressOf(base)
  return result
}

test('an honest draw verifies against the revealed seed', async () => {
  const drawn = await pickWeighted(SEED, 'round-1', roster(5))
  const check = await verifyResult(drawn, SEED, roster(5))

  assert.equal(check.valid, true)
  assert.equal(check.unchecked, undefined, 'every property was decidable from the receipt and roster')
})

test('a totalWeight that contradicts its own weights is refused', async () => {
  // The ticket is drawn modulo totalWeight. Shrinking it to 2 of 5 scaled
  // weights makes pupils 2-4 unreachable while every other field stays
  // self-consistent. This verified as valid before the sum was checked.
  const drawn = await pickWeighted(SEED, 'round-1', roster(5))
  const narrowed = 2_000_000

  drawn.receipt.totalWeight = narrowed
  drawn.receipt.ticket = await getUnbiasedInt(SEED, 'round-1', narrowed, drawn.receipt.domain)

  let cumulative = 0
  for (let i = 0; i < drawn.receipt.weights.length; i++) {
    cumulative += drawn.receipt.weights[i]!
    if (drawn.receipt.ticket < cumulative) {
      drawn.receipt.selectedIndex = i
      drawn.receipt.selectedValue = `pupil${i}`
      break
    }
  }

  const check = await verifyResult(await reseal(drawn), SEED, roster(5))

  assert.equal(check.valid, false)
  assert.match(String(check.reason), /totalWeight/)
})

test('renaming the winner is refused when the roster is supplied', async () => {
  const drawn = await pickWeighted(SEED, 'round-1', roster(5))
  drawn.receipt.selectedValue = 'the-headmasters-nephew'

  const check = await verifyResult(await reseal(drawn), SEED, roster(5))

  assert.equal(check.valid, false)
  assert.match(String(check.reason), /selectedValue|roster/)
})

test('a roster that is not the one drawn over is refused', async () => {
  const drawn = await pickWeighted(SEED, 'round-1', roster(5))
  const substituted = roster(5).map((s, i) => (i === 0 ? { ...s, value: 'someone-else' } : s))

  const check = await verifyResult(drawn, SEED, substituted)

  assert.equal(check.valid, false)
  assert.match(String(check.reason), /roster/)
})

test('without the roster the winner is reported unchecked, never assumed valid', async () => {
  // Honest scope: the receipt commits to the roster without carrying it, so a
  // verifier holding only the receipt cannot decide who `selectedValue` names.
  // It must say so rather than pass the property silently.
  const drawn = await pickWeighted(SEED, 'round-1', roster(5))
  const check = await verifyResult(drawn, SEED)

  assert.equal(check.valid, true)
  assert.ok(check.unchecked?.some((note) => note.includes('selectedValue')))
})

test('the roster commitment cannot be forged by repunctuating names', async () => {
  // Length-prefixing: ['a|b'] and ['a','b'] must not hash alike.
  const joined = await rosterHashOf([{ value: 'a|b', weight: 1 }])
  const split = await rosterHashOf([
    { value: 'a', weight: 1 },
    { value: 'b', weight: 1 },
  ])

  assert.notEqual(joined, split)
})

test('canonical joining is unambiguous under a delimiter in the input', () => {
  assert.notEqual(canonical(['a|b']), canonical(['a', 'b']))
  assert.notEqual(canonical(['1:a']), canonical(['a']))
})

test('a wrong seed does not verify', async () => {
  const drawn = await pickWeighted(SEED, 'round-1', roster(5))
  const check = await verifyResult(drawn, 'not-the-seed')

  assert.equal(check.valid, false)
})

test('the draw is unbiased across the whole roster', async () => {
  // Not a distribution proof — a guard against a mapping that can never reach
  // part of the roster, which is what the totalWeight forgery exploited.
  const seen = new Set<number>()
  for (let i = 0; i < 200; i++) {
    const drawn = await pickWeighted(`seed-${i}`, 'round', roster(5))
    seen.add(drawn.receipt.selectedIndex)
  }

  assert.equal(seen.size, 5, `every pupil was reachable; saw ${[...seen].sort().join(',')}`)
})

test('weights finer than the declared precision are refused, not truncated', async () => {
  await assert.rejects(() => pickWeighted(SEED, 'r', [{ value: 'a', weight: 1e-7 }]))
  await assert.rejects(() => pickWeighted(SEED, 'r', [{ value: 'a', weight: 0 }]))
  await assert.rejects(() => pickWeighted(SEED, 'r', []))
})
