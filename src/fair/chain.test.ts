import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GENESIS, linkHash, verifyChain } from './chain.js'

// A CHAIN PROVES ONLY THAT WHAT REMAINS AGREES WITH ITSELF. Deleting from the
// middle breaks every link after it. Deleting from the END breaks nothing —
// nothing follows to break — and the end is exactly where a draw somebody
// disliked would be removed. These tests hold that distinction open.

const chainOf = async (n: number, startAt = 1) => {
  let prev = GENESIS
  const links = []
  for (let seq = startAt; seq < startAt + n; seq++) {
    const contentAddress = String(seq).padStart(64, '0')
    const chainHash = await linkHash({ contentAddress, prevHash: prev, seq })
    links.push({ chainHash, id: seq, prevHash: prev, receipt: { contentAddress }, seq })
    prev = chainHash
  }
  return links
}

test('an untouched chain verifies', async () => {
  const result = await verifyChain(await chainOf(6))
  assert.equal(result.intact, true)
  assert.equal(result.length, 6)
})

test('a receipt removed from the middle breaks the chain', async () => {
  const links = await chainOf(6)
  links.splice(3, 1)

  const result = await verifyChain(links)
  assert.equal(result.intact, false)
  assert.match(String(result.break?.reason), /sequence gap/)
})

test('an altered receipt breaks its own link', async () => {
  const links = await chainOf(6)
  links[2]!.receipt = { contentAddress: 'ff'.repeat(32) }

  const result = await verifyChain(links)
  assert.equal(result.intact, false)
  assert.match(String(result.break?.reason), /does not follow/)
})

test('receipts deleted from the END are invisible without a checkpoint', async () => {
  // Documents the limit rather than hiding it: this is why a checkpoint exists.
  // If this ever starts failing, the chain gained a property it did not have.
  const result = await verifyChain((await chainOf(6)).slice(0, 3))

  assert.equal(result.intact, true, 'links alone cannot see a truncation')
  assert.equal(result.length, 3)
})

test('a checkpoint catches the truncation the links cannot', async () => {
  const result = await verifyChain((await chainOf(6)).slice(0, 3), {
    chainLength: 6,
    sealedAt: '2026-09-01T00:00:00.000Z',
  })

  assert.equal(result.intact, false)
  assert.equal(result.truncated?.sealedLength, 6)
  assert.equal(result.truncated?.have, 3)
})

test('a chain longer than its checkpoint is not a truncation', async () => {
  // Draws made after the last seal are ordinary, not tampering.
  const result = await verifyChain(await chainOf(9), { chainLength: 6 })

  assert.equal(result.intact, true)
  assert.equal(result.truncated, undefined)
})

// THE SEQUENCE ITSELF, which the chain tests above assumed and never asked
// about. verifyChain requires seq to run 1, 2, 3 with no gap — so three
// properties hold that nothing here stated: a trail must start at 1, a
// reorder is caught as surely as a deletion, and a chain of nothing verifies.

test('a trail that does not start at 1 is refused', async () => {
  // The constraint a school meets on the day it migrates, and the one nobody
  // reads about until then: an existing trail imported with its original
  // numbering — starting at 100, or at whatever the old system had reached —
  // does not verify, however honest every link in it is. The chain is
  // contiguous from 1 or it is not this chain.
  const imported = await chainOf(3, 5)
  const verified = await verifyChain(imported)

  assert.equal(verified.intact, false)
  assert.match(String(verified.break?.reason), /sequence gap/)
  assert.equal(verified.break?.expected, '1')
  assert.equal(verified.break?.found, '5')
})

test('two receipts in the wrong order are caught, not only a missing one', async () => {
  // The message says "missing or reordered" and only the missing half was
  // ever tested. A reorder changes which receipt each link commits to, so it
  // fails at the first link whose seq is not where it should be.
  const links = await chainOf(5)
  const swapped = [links[0]!, links[2]!, links[1]!, links[3]!, links[4]!]

  const verified = await verifyChain(swapped)
  assert.equal(verified.intact, false)
  assert.match(String(verified.break?.reason), /missing or reordered/)
})

test('a school that has never drawn has an intact chain of nothing', async () => {
  // Not a quibble: "intact" has to mean something before the first draw, or
  // every school fails its first audit. And it stays honest — a chain emptied
  // of all its receipts also reads intact, which is the same end-truncation
  // limit the checkpoint closes, not a separate hole.
  const empty = await verifyChain([])
  assert.equal(empty.intact, true)
  assert.equal(empty.length, 0)

  const emptied = await verifyChain([], { chainLength: 4, root: 'r', sealedAt: '2026-09-20' })
  assert.equal(emptied.intact, false, 'a chain emptied under a checkpoint must not read intact')
})

// ── verifying against a checkpoint instead of every receipt ──────────────────
//
// A link's hash commits to every link before it, so a checkpoint that recorded
// the head makes the prefix verifiable by ONE comparison. Measured on 50,000
// links: 2,261 ms recomputing everything, 5.5 ms from the checkpoint — 415x,
// 100 hashes instead of 50,000. On a runtime with a CPU limit that is the
// difference between an audit that answers and one that is killed.
test('the default recomputes every receipt and says so', async () => {
  const links = await chainOf(20)
  const out = await verifyChain(links, { chainLength: 10, head: links[9]!.chainHash })

  assert.equal(out.intact, true)
  assert.equal(out.recomputed, 20, 'a checkpoint alone changes nothing — the skip is opt-in')
  assert.equal(out.verifiedAgainst, 'receipts')
})

test('asked to trust the checkpoint, it recomputes only what follows it', async () => {
  const links = await chainOf(20)
  const out = await verifyChain(links, { chainLength: 10, head: links[9]!.chainHash }, { trustCheckpoint: true })

  assert.equal(out.intact, true)
  assert.equal(out.length, 20, 'the chain is still twenty long')
  assert.equal(out.recomputed, 10, 'ten hashes, not twenty')
  assert.equal(out.verifiedAgainst, 'checkpoint')
})

// THE SHORTCUT IS REFUSED WHEN THE HEAD HAS MOVED, which is the one case it
// must never take on trust: if the link at the sealed position no longer
// carries the hash the checkpoint recorded, the prefix has changed since the
// seal and there is nothing to skip.
test('a head that does not match refuses the skip and walks everything', async () => {
  const links = await chainOf(20)
  const out = await verifyChain(
    links,
    { chainLength: 10, head: 'f'.repeat(64) },
    { trustCheckpoint: true },
  )
  assert.equal(out.recomputed, 20)
  assert.equal(out.verifiedAgainst, 'receipts')
})

// AND WHAT IT GIVES UP, held to rather than glossed. Trusting a checkpoint
// means the stored hashes before it are never recomputed, so an edit there is
// invisible — and so is the prevHash that would have contradicted it. This is
// not a flaw in the check; it is what trusting a checkpoint means, and the
// package states it by REPORTING which claim it made.
test('a tampered prefix is caught by the default and hidden by the shortcut', async () => {
  const links = await chainOf(20)
  const checkpoint = { chainLength: 10, head: links[9]!.chainHash }
  const tampered = links.map((l, i) => (i === 3 ? { ...l, chainHash: 'f'.repeat(64) } : l))

  const honest = await verifyChain(tampered, checkpoint)
  assert.equal(honest.intact, false, 'recomputing every receipt finds it')
  assert.equal(honest.verifiedAgainst, 'receipts')

  const fast = await verifyChain(tampered, checkpoint, { trustCheckpoint: true })
  assert.equal(fast.intact, true, 'the shortcut cannot see inside the range it skipped')
  assert.equal(
    fast.verifiedAgainst,
    'checkpoint',
    'which is why the answer must carry what it rested on — an auditor reading "intact" alone would be misled',
  )
})

test('truncation is still caught with the shortcut taken', async () => {
  const links = await chainOf(20)
  const out = await verifyChain(
    links.slice(0, 15),
    { chainLength: 10, head: links[9]!.chainHash, sealedAt: '2027-05-04T07:00:00Z' },
    { trustCheckpoint: true },
  )
  // Fifteen is longer than the seal, so nothing is missing yet.
  assert.equal(out.intact, true)

  const short = await verifyChain(
    links.slice(0, 8),
    { chainLength: 10, head: links[9]!.chainHash },
    { trustCheckpoint: true },
  )
  assert.equal(short.intact, false, 'shorter than the seal — receipts removed from the end')
  assert.equal(short.truncated?.sealedLength, 10)
})

// ── verifying a suffix the caller fetched instead of the whole chain ─────────
//
// Trusting a checkpoint makes the prefix unnecessary to VERIFY, and then
// fetching it is the larger waste: the audit read 50,000 rows to recompute 100.
// Handed only the links after the seal, the walk must still report the true
// length, or a truncation check is measuring the wrong number.
test('a suffix that follows the seal verifies, and reports the whole length', async () => {
  const links = await chainOf(30)
  const checkpoint = { chainLength: 20, head: links[19]!.chainHash }
  const suffix = links.slice(20)

  const out = await verifyChain(suffix, checkpoint, { trustCheckpoint: true })

  assert.equal(out.intact, true)
  assert.equal(out.recomputed, 10, 'ten links were fetched and ten recomputed')
  assert.equal(out.length, 30, 'the chain is thirty long, not ten — the prefix exists, it was not read')
  assert.equal(out.verifiedAgainst, 'checkpoint')
})

// THE SUFFIX TEST IS THE STRONGER OF THE TWO. With the whole chain, the skip
// compares a STORED chainHash at the sealed position. With a suffix, it
// compares the first link's prevHash — which is what the next hash is actually
// computed from, rather than a value sitting in a row.
test('a suffix whose first link does not follow the seal is refused', async () => {
  const links = await chainOf(30)
  const suffix = links.slice(20)

  const out = await verifyChain(
    suffix,
    { chainLength: 20, head: 'f'.repeat(64) },
    { trustCheckpoint: true },
  )
  assert.equal(out.verifiedAgainst, 'receipts', 'the shortcut is refused when the seal is not what precedes it')
  assert.equal(out.intact, false, 'and walking from genesis then fails, because the prefix is absent')
})

test('a suffix starting at the wrong seq is refused even if the head matches', async () => {
  const links = await chainOf(30)
  const out = await verifyChain(
    links.slice(21),
    { chainLength: 20, head: links[19]!.chainHash },
    { trustCheckpoint: true },
  )
  assert.equal(out.verifiedAgainst, 'receipts', 'seq 22 does not follow a seal at 20')
})

// TRUNCATION AFTER THE SEAL IS INVISIBLE IN SUFFIX MODE, and it was invisible
// before the optimisation too — a checkpoint witnesses the length at the moment
// it was sealed, and draws removed after it are removed from a stretch no seal
// covers. Starting the count at the seal makes this explicit rather than new:
// `have` is chainLength plus what followed, so it can never fall below the
// sealed length. Whoever needs that question answered asks for a full walk, and
// the answer says which they got.
test('a suffix cannot report truncation, because it starts counting at the seal', async () => {
  const links = await chainOf(30)
  const checkpoint = { chainLength: 20, head: links[19]!.chainHash }

  // Draws 26..30 deleted; 21..25 survive.
  const out = await verifyChain(links.slice(20, 25), checkpoint, { trustCheckpoint: true })

  assert.equal(out.intact, true, 'every surviving link follows the one before it')
  assert.equal(out.truncated, undefined, 'and nothing sealed says there should be more')
  assert.equal(out.length, 25)
  assert.equal(out.verifiedAgainst, 'checkpoint')
})

test('a full walk still catches a chain shorter than its seal', async () => {
  const links = await chainOf(30)
  // Sealed at 28, only 25 survive, and the whole chain is handed over.
  const out = await verifyChain(links.slice(0, 25), { chainLength: 28 })

  assert.equal(out.intact, false)
  assert.equal(out.truncated?.sealedLength, 28)
  assert.equal(out.truncated?.have, 25)
  assert.equal(out.verifiedAgainst, 'receipts')
})
