/**
 * Provably fair weighted selection.
 *
 * This arrived as `wheel.ts`, with candidates as the *segments* of a wheel you
 * *spin* — vocabulary from the provably-fair gambling implementations the
 * scheme comes from. There is no wheel in a school. What there is, is a draw:
 * a pupil called on in a lesson, a place allotted by lottery. `ticket` and
 * `serverSeed` stay, because a ticket drawn from a sealed seed is what a school
 * lottery actually is and renaming those would cost a reader the standard
 * commit-reveal vocabulary for no gain.
 *
 * HMAC-SHA256 is used as a PRF over (server seed, public message) to produce a
 * deterministic uint32 stream; a ticket is drawn from that stream by rejection
 * sampling and mapped onto integer-scaled weights. Anyone holding the revealed
 * server seed and the receipt can recompute the result exactly.
 *
 * Written against Web Crypto (`crypto.subtle`) rather than `node:crypto` so the
 * same code runs in Workers, in Next.js route handlers, and in Node ≥ 20.
 *
 * Corrections applied over the original draft:
 * - inputs are length-prefixed before hashing, so a seed containing ':' cannot
 *   be made to collide with a different (seed, nonce, round) triple;
 * - the rejection bound is 2^32 (the size of the sample space) rather than the
 *   largest representable uint32;
 * - weights are scaled with Math.round over a validated decimal count, so no
 *   decimal library is involved and 1e-7-style inputs are rejected, not silently
 *   truncated.
 */

import { canonical, hmacBytes, hmacSha256, importHmacKey, sha256, toHex } from './hash.js'

const UINT32_LIMIT = 0x1_0000_0000 // 2^32 — the size of the space, not its max value
const MAX_WEIGHT_DECIMALS = 6
const WEIGHT_SCALE = 10 ** MAX_WEIGHT_DECIMALS


export type Candidate<T extends number | string> = {
  value: T
  weight: number
}

export type Receipt = {
  algorithm: 'HMAC-SHA256/uint32-rejection'
  contentAddress: string
  domain: string
  message: string
  /**
   * Commitment to the candidate list this draw ran over: H(canonical(values)).
   *
   * Without it the receipt fixes the *index* and nothing about whose name sits
   * at it, so `selectedValue` could be rewritten and the receipt still verify.
   * A hash rather than the list itself because the candidates are pupils, and
   * art. 5(1)(c) admits no more data than the purpose needs — anyone holding
   * the roster can check it; a receipt published alone still names one person.
   *
   * Optional only so receipts written before this field verify as legacy, with
   * the roster explicitly reported unchecked rather than silently assumed.
   */
  rosterHash?: string
  selectedIndex: number
  selectedValue: number | string
  serverSeedHash: string
  ticket: number
  timestamp: string
  totalWeight: number
  weights: number[]
}

export type SelectionResult<T extends number | string> = {
  hmac: string
  receipt: Receipt
  result: T
}

// Re-exported: these are part of this module's published surface, and a
// verifier elsewhere recomputes a receipt with exactly these.
export { canonical, hmacSha256, sha256 } from './hash.js'

/**
 * Deterministic, unbounded stream of 32-bit unsigned integers.
 *
 * Each HMAC block yields eight uint32s, most significant bit first; `step`
 * makes every block a distinct message under the same key.
 */
export async function* uint32Stream(key: string, message: string): AsyncGenerator<number> {
  const cryptoKey = await importHmacKey(key)
  let step = 0

  while (true) {
    const digest = await hmacBytes(cryptoKey, canonical([message, step]))

    for (let i = 0; i < digest.length; i += 4) {
      yield (
        ((digest[i]! << 24) | (digest[i + 1]! << 16) | (digest[i + 2]! << 8) | digest[i + 3]!) >>> 0
      )
    }

    step++
  }
}

/**
 * Draws an integer in [0, range) with no modulo bias.
 *
 * Values at or above the largest multiple of `range` that fits in 2^32 are
 * rejected and redrawn, so every outcome is equally likely.
 */
export async function getUnbiasedInt(
  key: string,
  message: string,
  range: number,
  domain: string,
): Promise<number> {
  if (!Number.isInteger(range) || range <= 0 || range > UINT32_LIMIT) {
    throw new Error(`Invalid range: ${range}`)
  }

  const maxAcceptable = UINT32_LIMIT - (UINT32_LIMIT % range)
  const stream = uint32Stream(key, canonical([message, domain]))

  // Rejection is geometric with ratio < 1/2 for any valid range; 256 draws is a
  // ceiling no honest run reaches, and it keeps a pathological seed from hanging.
  for (let draw = 0; draw < 256; draw++) {
    const { value } = await stream.next()
    if (value! < maxAcceptable) return value! % range
  }

  throw new Error('Failed to draw an unbiased value within the retry ceiling')
}

function countWeightDecimals(weight: number): number {
  const text = weight.toString()
  if (text.includes('e') || text.includes('E')) {
    // toString() gave exponent notation, e.g. 1e-7: more precision than allowed.
    return MAX_WEIGHT_DECIMALS + 1
  }
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

function scaleWeight(weight: number, label: number | string): number {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error(`Invalid weight for ${label}: ${weight}`)
  }
  if (countWeightDecimals(weight) > MAX_WEIGHT_DECIMALS) {
    throw new Error(`Weight for ${label} exceeds ${MAX_WEIGHT_DECIMALS} decimals`)
  }

  const scaled = Math.round(weight * WEIGHT_SCALE)
  if (!Number.isSafeInteger(scaled) || scaled <= 0) {
    throw new Error(`Invalid scaled weight for ${label}`)
  }
  return scaled
}

/**
 * Picks one candidate. `message` is the public input (client seed, nonce, round);
 * `domain` separates one use of the seed pair from another, so a student call
 * and a lottery round can never draw the same ticket.
 */
export async function pickWeighted<T extends number | string>(
  serverSeed: string,
  message: string,
  candidates: Candidate<T>[],
  domain = 'draw',
): Promise<SelectionResult<T>> {
  if (!candidates.length) throw new Error('No candidates provided')

  const weights = candidates.map((candidate) => scaleWeight(candidate.weight, candidate.value))
  const totalWeight = weights.reduce((sum, weight) => {
    const next = sum + weight
    if (!Number.isSafeInteger(next)) throw new Error('Total weight exceeds safe integer range')
    return next
  }, 0)

  const ticket = await getUnbiasedInt(serverSeed, message, totalWeight, domain)

  let cumulative = 0
  let selectedIndex = -1

  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i]!
    if (ticket < cumulative) {
      selectedIndex = i
      break
    }
  }

  if (selectedIndex === -1) throw new Error('Weighted selection logic failure')

  const base = {
    algorithm: 'HMAC-SHA256/uint32-rejection' as const,
    domain,
    message,
    rosterHash: await rosterHashOf(candidates),
    selectedIndex,
    selectedValue: candidates[selectedIndex]!.value,
    serverSeedHash: await sha256(serverSeed),
    ticket,
    timestamp: new Date().toISOString(),
    totalWeight,
    weights,
  }

  const receipt: Receipt = { ...base, contentAddress: await contentAddressOf(base) }

  return {
    hmac: await hmacSha256(serverSeed, canonical([message, domain])),
    receipt,
    result: candidates[selectedIndex]!.value,
  }
}

/**
 * Commitment to the ordered candidate list. Length-prefixed like every other
 * input here, so a roster of ['a|b'] cannot be passed off as ['a', 'b'].
 */
export const rosterHashOf = <T extends number | string>(
  candidates: Candidate<T>[],
): Promise<string> => sha256(canonical(candidates.map((candidate) => candidate.value)))

/** Content address of a receipt: SHA-256 over its fields in sorted-key order. */
export async function contentAddressOf(receipt: Omit<Receipt, 'contentAddress'>): Promise<string> {
  const ordered = Object.keys(receipt)
    .sort()
    .map((key) => [key, receipt[key as keyof typeof receipt]])
  return sha256(JSON.stringify(ordered))
}

export type Verification = {
  /**
   * What this run could not decide, rather than what it assumed. An empty list
   * means every property was checked against the receipt itself.
   */
  unchecked?: string[]
  reason?: string
  recomputed?: Pick<Receipt, 'contentAddress' | 'selectedIndex' | 'ticket'>
  valid: boolean
}

/**
 * Recomputes a selection from the revealed server seed and reports whether the
 * stored receipt matches. Every mismatch names which field disagreed.
 */
export async function verifyResult<T extends number | string>(
  stored: { hmac?: null | string; receipt: Receipt },
  serverSeed: string,
  /**
   * The candidate list the draw ran over. Supply it to check that the winner
   * named in the receipt is the one the ticket actually landed on; omit it and
   * that single property is reported unchecked, never assumed.
   */
  candidates?: Candidate<T>[],
): Promise<Verification> {
  const { receipt } = stored
  const unchecked: string[] = []

  if (!receipt?.message || typeof receipt.ticket !== 'number') {
    return { reason: 'receipt is missing the fields needed to recompute', valid: false }
  }

  // The ticket is drawn modulo totalWeight, so a totalWeight that disagrees
  // with the weights it claims to total is a narrowed range: the tail of the
  // roster becomes unreachable while every other field stays self-consistent.
  const summed = receipt.weights.reduce((sum, weight) => sum + weight, 0)
  if (summed !== receipt.totalWeight) {
    return {
      reason: `totalWeight ${receipt.totalWeight} does not equal the sum of its weights (${summed}) — the draw ran over a narrower range than the receipt claims`,
      valid: false,
    }
  }

  const seedHash = await sha256(serverSeed)
  if (receipt.serverSeedHash && seedHash !== receipt.serverSeedHash) {
    return { reason: 'revealed server seed does not match the committed hash', valid: false }
  }

  const ticket = await getUnbiasedInt(
    serverSeed,
    receipt.message,
    receipt.totalWeight,
    receipt.domain,
  )

  if (ticket !== receipt.ticket) {
    return { reason: `ticket mismatch: recomputed ${ticket}, stored ${receipt.ticket}`, valid: false }
  }

  let cumulative = 0
  let selectedIndex = -1
  for (let i = 0; i < receipt.weights.length; i++) {
    cumulative += receipt.weights[i]!
    if (ticket < cumulative) {
      selectedIndex = i
      break
    }
  }

  if (selectedIndex !== receipt.selectedIndex) {
    return { reason: 'selected index does not follow from the ticket', valid: false }
  }

  const { contentAddress: _stored, ...base } = receipt
  const contentAddress = await contentAddressOf(base)

  if (contentAddress !== receipt.contentAddress) {
    return { reason: 'receipt content address does not match its fields', valid: false }
  }

  if (stored.hmac) {
    const hmac = await hmacSha256(serverSeed, canonical([receipt.message, receipt.domain]))
    if (hmac !== stored.hmac) return { reason: 'stored HMAC does not match', valid: false }
  }

  // Which name sits at the winning index is the one thing the receipt cannot
  // establish alone, by design: it commits to the roster without carrying it.
  if (!receipt.rosterHash) {
    unchecked.push('rosterHash: receipt predates the roster commitment')
  } else if (!candidates) {
    unchecked.push('selectedValue: the candidate list was not supplied, so the winner named here is unconfirmed')
  } else {
    if ((await rosterHashOf(candidates)) !== receipt.rosterHash) {
      return { reason: 'candidate list does not match the roster this receipt committed to', valid: false }
    }
    if (candidates[selectedIndex]?.value !== receipt.selectedValue) {
      return {
        reason: `selectedValue does not sit at index ${selectedIndex} of the roster: receipt names ${String(receipt.selectedValue)}, the draw landed on ${String(candidates[selectedIndex]?.value)}`,
        valid: false,
      }
    }
    if (candidates.length !== receipt.weights.length) {
      return { reason: 'candidate list is a different length than the weights drawn over', valid: false }
    }
  }

  return {
    recomputed: { contentAddress, selectedIndex, ticket },
    valid: true,
    ...(unchecked.length ? { unchecked } : {}),
  }
}
