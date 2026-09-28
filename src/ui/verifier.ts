/**
 * The recomputation, as it runs in a parent's browser.
 *
 * The README has always said a parent can check a draw "without this server".
 * A page that asked the server whether the draw was fair and printed the
 * answer would make that sentence false while looking like it made it true —
 * it would be a nicer way of being told, not a way of checking.
 *
 * So this is the arithmetic, done locally: the ticket from the revealed seed,
 * the index from the weights, and the inclusion path walked up to the sealed
 * root. Nothing here asks the server anything.
 *
 * It is a second implementation of algorithms `fair/` already has, which this
 * package otherwise refuses to allow. The reason it is tolerable is that it is
 * held to the first one: `verifier.test.ts` executes this exact source against
 * the library over generated vectors and fails if they ever disagree. A copy
 * proven equal on every run is a copy; a copy nobody compares is a fork.
 *
 * Kept as source text rather than a module because it has to reach a browser
 * from a Worker, where there is no file to serve and no bundler to run.
 */

export const VERIFIER_SOURCE = String.raw`
const enc = new TextEncoder()

const toHex = (bytes) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const fromHex = (hex) => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('Not a hex string: ' + hex)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

const sha256 = async (text) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)))

const sha256Bytes = async (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const p of parts) { joined.set(p, at); at += p.length }
  return toHex(await crypto.subtle.digest('SHA-256', joined))
}

/** Length-prefixed join: a delimiter inside a part cannot forge a part list. */
const canonical = (parts) =>
  parts.map((part) => { const t = String(part); return enc.encode(t).length + ':' + t }).join('|')

const importKey = (key) =>
  crypto.subtle.importKey('raw', enc.encode(key), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign'])

async function* uint32Stream(key, message) {
  const k = await importKey(key)
  let step = 0
  while (true) {
    const d = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(canonical([message, step]))))
    for (let i = 0; i < d.length; i += 4) {
      yield ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0
    }
    step++
  }
}

const UINT32_LIMIT = 0x100000000

/** Rejection sampling against 2^32 — the size of the space, not its max value. */
async function getUnbiasedInt(key, message, range, domain) {
  if (!Number.isInteger(range) || range <= 0 || range > UINT32_LIMIT) throw new Error('Invalid range: ' + range)
  const maxAcceptable = UINT32_LIMIT - (UINT32_LIMIT % range)
  const stream = uint32Stream(key, canonical([message, domain]))
  for (let draw = 0; draw < 256; draw++) {
    const { value } = await stream.next()
    if (value < maxAcceptable) return value % range
  }
  throw new Error('Failed to draw an unbiased value within the retry ceiling')
}

const hashLeaf = (leaf) => sha256Bytes(new Uint8Array([0x00]), fromHex(leaf))
const hashNode = (l, r) => sha256Bytes(new Uint8Array([0x01]), fromHex(l), fromHex(r))

/** Walks the sibling path up to a root. Needs no other pupil's receipt. */
async function verifyInclusion(proof) {
  let computed = await hashLeaf(proof.leaf)
  for (const step of proof.path) {
    computed = step.side === 'left' ? await hashNode(step.hash, computed) : await hashNode(computed, step.hash)
  }
  return computed === proof.root
}

/**
 * Everything decidable from the receipt and the revealed seed.
 *
 * Each step is reported separately, because "verified" as one word hides which
 * parts were actually recomputed here and which were taken on trust.
 */
async function checkDraw(draw) {
  const r = draw.receipt
  const steps = []
  const add = (name, ok, detail) => steps.push({ detail, name, ok })

  if (!draw.serverSeed) {
    add('seed revealed', null, 'the seed has not been published, so nobody can recompute this draw yet')
    return { steps, verdict: null }
  }

  const summed = (r.weights || []).reduce((a, b) => a + b, 0)
  add('weights total correctly', summed === r.totalWeight,
    'declared ' + r.totalWeight + ', weights sum to ' + summed)

  const seedHash = await sha256(draw.serverSeed)
  add('seed matches its commitment', seedHash === r.serverSeedHash, seedHash)

  const ticket = await getUnbiasedInt(draw.serverSeed, r.message, r.totalWeight, r.domain)
  add('ticket recomputes', ticket === r.ticket, 'recomputed ' + ticket + ', receipt says ' + r.ticket)

  let cumulative = 0
  let index = -1
  for (let i = 0; i < r.weights.length; i++) {
    cumulative += r.weights[i]
    if (ticket < cumulative) { index = i; break }
  }
  add('index follows from the ticket', index === r.selectedIndex,
    'position ' + index + ' of ' + r.weights.length)

  // THE STEP THAT TIES THIS RECEIPT TO THAT PROOF, and it was missing.
  //
  // Everything above proves a draw landed on index N, and the inclusion proof
  // below proves a leaf sits under the sealed root. Neither says the receipt
  // on this page IS that leaf — so a server could hand over an honest proof
  // beside a receipt whose winner had been changed, and every check passed.
  // Demonstrated in a browser against this page before it was fixed.
  //
  // The address is over the receipt's own fields, so recomputing it needs the
  // selected value. Where the school has withheld that, the step is reported
  // as attested rather than skipped: a verdict of "every check passed" must
  // not be able to mean "every check we could still run".
  if (typeof r.selectedValue === 'undefined') {
    add('receipt matches its content address', null,
      'the selected value is withheld, so this server attests the address rather than you recomputing it')
  } else {
    const fields = {}
    for (const key of Object.keys(r)) if (key !== 'contentAddress') fields[key] = r[key]
    const ordered = Object.keys(fields).sort().map((key) => [key, fields[key]])
    const address = await sha256(JSON.stringify(ordered))
    add('receipt matches its content address', address === r.contentAddress, address)
  }

  if (draw.inclusion && draw.inclusion.path) {
    const included = await verifyInclusion(draw.inclusion)
    const isThisReceipt = !draw.inclusion.leaf || draw.inclusion.leaf === r.contentAddress
    add('sealed into the published root', included && isThisReceipt,
      isThisReceipt ? draw.inclusion.root : 'the proof is for a different receipt than the one shown')
  } else {
    add('sealed into the published root', null, 'this draw is not in the current sealed set')
  }

  const decided = steps.filter((s) => s.ok !== null)
  return { steps, verdict: decided.length > 0 && decided.every((s) => s.ok) }
}

export { canonical, checkDraw, getUnbiasedInt, sha256, verifyInclusion }
`
