/**
 * Merkle sealing for selection receipts.
 *
 * A receipt proves one draw was fair. A Merkle root proves the *set* of draws
 * has not been edited since it was sealed: no receipt added, removed or altered
 * without changing the root. The root is then mirrored to qpu storage, which
 * timestamps it outside this database and serves it to anyone without a login.
 *
 * Deliberately self-contained: SHA-256 over Web Crypto, no service call. An
 * auditor with this file — or any RFC 6962 implementation — can recompute a
 * root and check a proof years from now, whether or not this CMS still exists.
 *
 * Conventions, all of which matter for interoperability:
 * - leaves are **sorted** before the tree is built, so the root depends on the
 *   set and not on insertion order;
 * - leaves and internal nodes are domain-separated (0x00 / 0x01 prefixes), so a
 *   node value can never be replayed as a leaf — the RFC 6962 second-preimage
 *   defence;
 * - an odd node at any level is promoted unchanged to the next level, rather
 *   than duplicated, which avoids the CVE-2012-2459 duplicate-leaf ambiguity.
 */

import { fromHex, sha256Bytes } from './hash.js'

const LEAF_PREFIX = 0x00
const NODE_PREFIX = 0x01

const hashLeaf = (leaf: string) => sha256Bytes(new Uint8Array([LEAF_PREFIX]), fromHex(leaf))

const hashNode = (left: string, right: string) =>
  sha256Bytes(new Uint8Array([NODE_PREFIX]), fromHex(left), fromHex(right))

export type ProofStep = {
  hash: string
  side: 'left' | 'right'
}

export type InclusionProof = {
  index: number
  leaf: string
  path: ProofStep[]
  root: string
}

/** Sorted, de-duplicated leaves — the canonical order the root is built over. */
export const canonicalLeaves = (leaves: string[]): string[] =>
  [...new Set(leaves.map((leaf) => leaf.toLowerCase()))].sort()

async function levels(leaves: string[]): Promise<string[][]> {
  if (!leaves.length) throw new Error('Cannot build a Merkle tree over zero leaves')

  const bottom = await Promise.all(canonicalLeaves(leaves).map(hashLeaf))
  const all: string[][] = [bottom]

  let current = bottom
  while (current.length > 1) {
    const next: string[] = []
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!
      const right = current[i + 1]
      // Odd node: promoted, not duplicated.
      next.push(right === undefined ? left : await hashNode(left, right))
    }
    all.push(next)
    current = next
  }

  return all
}

/** Root over the set of leaves. Independent of the order they arrive in. */
export async function merkleRoot(leaves: string[]): Promise<string> {
  const tree = await levels(leaves)
  return tree[tree.length - 1]![0]!
}

/** O(log n) inclusion proof for one leaf. */
export async function merkleProof(leaves: string[], leaf: string): Promise<InclusionProof> {
  // Not `canonical`: that name means the length-prefixed join in hash.ts, and
  // one word meaning two things in one package is how the wrong one gets used.
  const ordered = canonicalLeaves(leaves)
  const index = ordered.indexOf(leaf.toLowerCase())
  if (index === -1) throw new Error('Leaf is not in this set')

  const tree = await levels(ordered)
  const path: ProofStep[] = []
  let position = index

  for (let level = 0; level < tree.length - 1; level++) {
    const nodes = tree[level]!
    const isRight = position % 2 === 1
    const siblingIndex = isRight ? position - 1 : position + 1
    const sibling = nodes[siblingIndex]

    // No sibling means this node was promoted; nothing to record at this level.
    if (sibling !== undefined) {
      path.push({ hash: sibling, side: isRight ? 'left' : 'right' })
    }

    position = Math.floor(position / 2)
  }

  return { index, leaf: leaf.toLowerCase(), path, root: tree[tree.length - 1]![0]! }
}

/**
 * Checks a leaf against a root. Needs only the proof — not the other leaves —
 * which is what lets a parent verify one draw without seeing every other.
 */
export async function verifyInclusion(proof: InclusionProof): Promise<boolean> {
  let computed = await hashLeaf(proof.leaf)

  for (const step of proof.path) {
    computed =
      step.side === 'left' ? await hashNode(step.hash, computed) : await hashNode(computed, step.hash)
  }

  return computed === proof.root
}
