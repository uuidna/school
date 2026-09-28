import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canonicalLeaves, merkleProof, merkleRoot, verifyInclusion } from './merkle.js'

const leaf = (n: number) => String(n).padStart(64, '0')
const leaves = (n: number) => Array.from({ length: n }, (_, i) => leaf(i + 1))

test('an inclusion proof verifies against the root', async () => {
  const set = leaves(7)
  const proof = await merkleProof(set, set[3]!)

  assert.equal(await verifyInclusion(proof), true)
  assert.equal(proof.root, await merkleRoot(set))
})

test('the root commits to the set, not the order it arrived in', async () => {
  const set = leaves(7)
  assert.equal(await merkleRoot(set), await merkleRoot([...set].reverse()))
})

test('a proof with a substituted leaf does not verify', async () => {
  const set = leaves(7)
  const proof = await merkleProof(set, set[3]!)

  assert.equal(await verifyInclusion({ ...proof, leaf: leaf(99) }), false)
})

test('a leaf outside the set has no proof', async () => {
  await assert.rejects(() => merkleProof(leaves(7), leaf(99)))
})

test('an internal node cannot be replayed as a leaf', async () => {
  // RFC 6962 second-preimage defence: leaves and nodes are domain-separated,
  // so a node value presented as a leaf must not verify.
  const set = leaves(4)
  const root = await merkleRoot(set)
  const proof = await merkleProof(set, set[0]!)

  assert.notEqual(await merkleRoot([root]), root)
  assert.equal(await verifyInclusion({ ...proof, leaf: root }), false)
})

test('adding a receipt changes the root', async () => {
  assert.notEqual(await merkleRoot(leaves(7)), await merkleRoot(leaves(8)))
})

test('duplicate leaves collapse — a documented limit of a set commitment', async () => {
  // The root commits to a SET. Two receipts sharing a content address are one
  // leaf, so leafCount can differ from the receipt count. The chain, not the
  // root, is what commits to order and multiplicity.
  const set = leaves(4)
  assert.equal(canonicalLeaves([...set, set[0]!]).length, 4)
  assert.equal(await merkleRoot(set), await merkleRoot([...set, set[0]!]))
})

test('a tree over zero leaves is an error, not an empty root', async () => {
  await assert.rejects(() => merkleRoot([]))
})
