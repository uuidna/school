import assert from 'node:assert/strict'
import { test } from 'node:test'

import { merkleProof, merkleRoot } from '../fair/merkle.js'
import { canonical, getUnbiasedInt, pickWeighted, sha256, verifyResult } from '../fair/draw.js'
import { VERIFIER_SOURCE } from './verifier.js'

// A SECOND IMPLEMENTATION IS ONLY TOLERABLE IF SOMETHING COMPARES THEM. This
// package refuses duplicated primitives everywhere else; the page needs its own
// copy because it runs in a browser with no module to fetch from a Worker. So
// the copy is held to the original here, on generated vectors, every run. A
// copy proven equal is a copy. A copy nobody compares is a fork.

/** The page's verifier, loaded as a real module. */
const load = async () => {
  const url = `data:text/javascript;base64,${Buffer.from(VERIFIER_SOURCE).toString('base64')}`
  return (await import(url)) as {
    canonical: (parts: (number | string)[]) => string
    checkDraw: (draw: unknown) => Promise<{
      steps: { detail: string; name: string; ok: boolean | null }[]
      verdict: boolean | null
    }>
    getUnbiasedInt: (k: string, m: string, r: number, d: string) => Promise<number>
    sha256: (text: string) => Promise<string>
    verifyInclusion: (proof: unknown) => Promise<boolean>
  }
}

const roster = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `p${i}`, weight: i + 1 }))

const SEED = 'server-seed'

test('the page hashes the same as the library', async () => {
  const page = await load()

  for (const text of ['', 'a', 'Правилник за дейността', 'a|b', '7', '🙂 щ']) {
    assert.equal(await page.sha256(text), await sha256(text), `sha256 differs for ${text!}`)
  }
})

test('the page joins inputs the same as the library', async () => {
  const page = await load()

  for (const parts of [['a|b'], ['a', 'b'], [7, 'щ'], ['1:a'], []] as (number | string)[][]) {
    assert.equal(page.canonical(parts), canonical(parts), `canonical differs for ${JSON.stringify(parts)}`)
  }
})

test('the page draws the same ticket as the library', async () => {
  // Across seeds, ranges and domains — the rejection loop is where a subtle
  // difference would hide, and it only shows on some values.
  const page = await load()

  for (let i = 0; i < 25; i++) {
    const seed = `seed-${i}`
    const range = 1 + ((i * 7919) % 100000)
    const domain = i % 2 ? 'draw' : 'lottery:round'

    assert.equal(
      await page.getUnbiasedInt(seed, `round-${i}`, range, domain),
      await getUnbiasedInt(seed, `round-${i}`, range, domain),
      `ticket differs at i=${i}, range=${range}`,
    )
  }
})

test('the page walks an inclusion proof the same as the library', async () => {
  const page = await load()
  const leaves = await Promise.all([...Array(9)].map((_, i) => sha256(`leaf-${i}`)))
  const root = await merkleRoot(leaves)

  for (const leaf of leaves) {
    const proof = await merkleProof(leaves, leaf)
    assert.equal(await page.verifyInclusion(proof), true)
    assert.equal(proof.root, root)
  }
})

test('the page rejects a proof the library would reject', async () => {
  const page = await load()
  const leaves = await Promise.all([...Array(5)].map((_, i) => sha256(`leaf-${i}`)))
  const proof = await merkleProof(leaves, leaves[2]!)

  assert.equal(await page.verifyInclusion({ ...proof, leaf: await sha256('not a leaf') }), false)
  assert.equal(await page.verifyInclusion({ ...proof, root: '00'.repeat(32) }), false)
})

test('an honest draw passes every step in the browser', async () => {
  const page = await load()
  const drawn = await pickWeighted('server-seed', 'round-1', roster(6))
  const leaves = [drawn.receipt.contentAddress]

  const checked = await page.checkDraw({
    inclusion: await merkleProof(leaves, drawn.receipt.contentAddress),
    receipt: drawn.receipt,
    serverSeed: 'server-seed',
  })

  assert.equal(checked.verdict, true)
  for (const step of checked.steps) assert.notEqual(step.ok, false, `${step.name} failed`)
})

test('the forgeries the library refuses, the page refuses too', async () => {
  const page = await load()
  const drawn = await pickWeighted('server-seed', 'round-1', roster(5))

  // totalWeight narrowed so the tail of the roster is unreachable.
  const narrowed = structuredClone(drawn.receipt)
  narrowed.totalWeight = 2
  const a = await page.checkDraw({ receipt: narrowed, serverSeed: 'server-seed' })
  assert.equal(a.verdict, false)
  assert.equal(a.steps.find((s) => s.name === 'weights total correctly')!.ok, false)

  // A ticket that was not drawn from this seed.
  const moved = structuredClone(drawn.receipt)
  moved.ticket = (moved.ticket + 1) % moved.totalWeight
  const b = await page.checkDraw({ receipt: moved, serverSeed: 'server-seed' })
  assert.equal(b.verdict, false)

  // A seed that does not match its published commitment.
  const c = await page.checkDraw({ receipt: drawn.receipt, serverSeed: 'a-different-seed' })
  assert.equal(c.verdict, false)
  assert.equal(c.steps.find((s) => s.name === 'seed matches its commitment')!.ok, false)
})

test('an unrevealed seed is reported as undecidable, not as a pass', async () => {
  const page = await load()
  const drawn = await pickWeighted('server-seed', 'round-1', roster(4))

  const checked = await page.checkDraw({ receipt: drawn.receipt, serverSeed: null })

  assert.equal(checked.verdict, null)
  assert.equal(checked.steps[0]!.ok, null)
  assert.match(checked.steps[0]!.detail, /nobody can recompute/)
})

test('a draw outside the sealed set says so rather than failing silently', async () => {
  const page = await load()
  const drawn = await pickWeighted('server-seed', 'round-1', roster(4))

  const checked = await page.checkDraw({ receipt: drawn.receipt, serverSeed: 'server-seed' })
  const sealed = checked.steps.find((s) => s.name === 'sealed into the published root')!

  assert.equal(sealed.ok, null)
  assert.match(sealed.detail, /not in the current sealed set/)
})

test('each step is reported separately, so "verified" cannot hide a gap', async () => {
  const page = await load()
  const drawn = await pickWeighted('server-seed', 'round-1', roster(3))
  const checked = await page.checkDraw({ receipt: drawn.receipt, serverSeed: 'server-seed' })

  assert.ok(checked.steps.length >= 4)
  for (const step of checked.steps) {
    assert.equal(typeof step.name, 'string')
    assert.ok(step.name.length > 0)
  }
})

test('a receipt whose winner was swapped is refused, as the library refuses it', async () => {
  // Found in a browser, not in this file: the page proved a leaf sits under
  // the sealed root and never proved the receipt it was SHOWING was that
  // leaf. A server could serve an honest inclusion proof beside a receipt
  // whose selectedValue had been changed, and the page said every check
  // passed. The library catches it — "receipt content address does not match
  // its fields" — so the page was a fork of the library in exactly one step.
  const honest = await pickWeighted(SEED, 'round-1', roster(6))
  const other = await pickWeighted(SEED, 'round-2', roster(6))

  const swapped = {
    ...honest,
    receipt: { ...honest.receipt, selectedValue: other.receipt.selectedValue },
  }

  // The library's verdict, and the page's, on the same forgery.
  assert.equal((await verifyResult(swapped, SEED)).valid, false)

  const page = await (await load()).checkDraw({ receipt: swapped.receipt, serverSeed: SEED })
  const address = page.steps.find((step) => step.name === 'receipt matches its content address')

  assert.equal(address?.ok, false, 'the page accepted a receipt that is not its own address')
  assert.equal(page.verdict, false)
})

test('an honest published receipt still recomputes its address here', async () => {
  const honest = await pickWeighted(SEED, 'round-1', roster(6))
  const page = await (await load()).checkDraw({ receipt: honest.receipt, serverSeed: SEED })
  const address = page.steps.find((step) => step.name === 'receipt matches its content address')

  assert.equal(address?.ok, true)
})

test('a withheld outcome is attested, not silently skipped', async () => {
  // The other half: where the school has not published the winner, the
  // address cannot be recomputed by anyone but the server. Reporting that as
  // undecidable is what keeps "every check passed" from meaning "every check
  // that was still possible".
  const honest = await pickWeighted(SEED, 'round-1', roster(6))
  const { selectedValue: _withheld, ...withoutOutcome } = honest.receipt

  const page = await (await load()).checkDraw({ receipt: withoutOutcome, serverSeed: SEED })
  const address = page.steps.find((step) => step.name === 'receipt matches its content address')

  assert.equal(address?.ok, null)
  assert.match(String(address?.detail), /attests the address/)
})

test('a proof for another receipt does not pass as this one’s', async () => {
  const honest = await pickWeighted(SEED, 'round-1', roster(6))
  const other = await pickWeighted(SEED, 'round-2', roster(6))
  const leaves = [honest.receipt.contentAddress, other.receipt.contentAddress]
  const proof = await merkleProof(leaves, other.receipt.contentAddress)

  const page = await (await load()).checkDraw({
    inclusion: proof,
    receipt: honest.receipt,
    serverSeed: SEED,
  })
  const sealed = page.steps.find((step) => step.name === 'sealed into the published root')

  assert.equal(sealed?.ok, false)
  assert.match(String(sealed?.detail), /different receipt/)
})
