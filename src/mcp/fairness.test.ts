import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { contentAddressOf, pickWeighted } from '../fair/draw.js'
import { fairnessMcpTools } from './fairness.js'

// A PARENT MUST BE ABLE TO CHECK THE DRAW WITHOUT LEARNING ANOTHER CHILD'S
// NAME. Most of these tests are about what does not come back: another class's
// draws, the other leaves of the tree, and the selected pupil where the school
// has not published the outcome.

const tool = fairnessMcpTools[0]!

const SEED = 'seed-for-12a'

const drawFor = async (klass: string, seq: number, published = false) => {
  const result = await pickWeighted(SEED, `round-${seq}`, [
    { value: 'pupil-a', weight: 1 },
    { value: 'pupil-b', weight: 1 },
    { value: 'pupil-c', weight: 1 },
  ])

  return {
    chainHash: `chain-${seq}`,
    class: klass,
    hmac: result.hmac,
    id: seq,
    outcomePublished: published,
    prevHash: `chain-${seq - 1}`,
    receipt: result.receipt,
    serverSeed: SEED,
    seq,
    tenant: 1,
  }
}


/** A host that records a tenant on these collections, as tenantFieldOf reads it. */
const TENANTED = {
  documents: { config: { flattenedFields: [{ name: 'title' }, { name: 'tenant' }] } },
  'random-selections': { config: { flattenedFields: [{ name: 'seq' }, { name: 'tenant' }] } },
  users: {
    config: { flattenedFields: [{ name: 'email' }, { name: 'tenants', flattenedFields: [{ name: 'tenant' }] }] },
  },
}

const run = async (
  args: Record<string, unknown>,
  user: Record<string, unknown> | null,
  rows: Record<string, unknown>[],
) => {
  const reads: Record<string, unknown>[] = []
  const payload = {
    collections: TENANTED as never,
    count: async () => ({ totalDocs: 1 }),
    find: async (a: Record<string, unknown>) => {
      reads.push(a)
      if (a.collection === 'tenants') {
        return { docs: [{ id: 1, domain: 'school.bg' }], hasNextPage: false, totalDocs: 1 }
      }
      // findAll nests a caller's filter under `and` alongside the tenant
      // scope, so the class clause has to be dug out of either shape.
      const clauseFor = (where: unknown, field: string): unknown => {
        const w = where as { and?: unknown[] } & Record<string, { equals?: unknown }>
        if (w?.[field]?.equals !== undefined) return w[field]!.equals
        for (const part of w?.and ?? []) {
          const found = (part as Record<string, { equals?: unknown }>)[field]?.equals
          if (found !== undefined) return found
        }
        return undefined
      }

      const klass = clauseFor(a.where, 'class')
      const docs = klass ? rows.filter((r) => r.class === klass) : rows
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
  }
  const req = {
    headers: new Headers({ host: 'school.bg' }),
    payload,
    user,
  } as unknown as PayloadRequest

  const result = await tool.handler(args, req)
  return { isError: result.isError, reads, text: result.content[0]!.text }
}

const parent = { class: '12a@students.school.bg', email: 'p@x', id: 1, role: 'parent' }
const otherParent = { class: '12b@students.school.bg', email: 'q@x', id: 2, role: 'parent' }
const head = { email: 'h@x', id: 3, role: 'admin' }

test('a parent sees the draws of their own class', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1)]
  const { text } = await run({}, parent, rows)
  const out = JSON.parse(text)

  assert.equal(out.class, '12a@students.school.bg')
  assert.equal(out.draws.length, 1)
})

test('a parent asking for another class is refused', async () => {
  const rows = [await drawFor('12b@students.school.bg', 1)]
  const { isError, text } = await run({ class: '12b@students.school.bg' }, parent, rows)

  assert.equal(isError, true)
  assert.match(text, /your own class/i)
})

test('a parent of another class is answered about theirs, never the one asked for', async () => {
  const rows = [
    await drawFor('12a@students.school.bg', 1),
    await drawFor('12b@students.school.bg', 2),
  ]
  const { text } = await run({}, otherParent, rows)
  const out = JSON.parse(text)

  assert.equal(out.class, '12b@students.school.bg')
  assert.equal(out.draws.length, 1)
  assert.equal(out.draws[0].seq, 2)
})

test('a parent may name their own class, in any case', async () => {
  // Two guards overlap here on purpose: the caller's class is substituted for
  // whatever they asked for, AND asking for another class is refused. This
  // pins the path where the parent names their own.
  const rows = [
    await drawFor('12a@students.school.bg', 1),
    await drawFor('12b@students.school.bg', 2),
  ]
  const out = JSON.parse((await run({ class: '12A@Students.School.BG' }, parent, rows)).text)

  assert.equal(out.draws.length, 1)
  assert.equal(out.draws[0].seq, 1)
})

test('an account with no class is told so, rather than shown everything', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1)]
  const { isError, text } = await run({}, { email: 'n@x', id: 9, role: 'parent' }, rows)

  assert.equal(isError, true)
  assert.match(text, /not linked to a class/)
})

test('staff may name a class', async () => {
  const rows = [await drawFor('12b@students.school.bg', 1)]
  const { text } = await run({ class: '12b@students.school.bg' }, head, rows)

  assert.equal(JSON.parse(text).draws.length, 1)
})

test('an unpublished outcome withholds the selected pupil entirely', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1, false)]
  const { text } = await run({}, parent, rows)
  const out = JSON.parse(text)

  assert.equal(out.draws[0].outcome.published, false)
  assert.equal(out.draws[0].outcome.selected, undefined)
  assert.equal(out.draws[0].receipt.selectedValue, undefined)
  // And the name must not appear anywhere else in the payload either.
  assert.ok(!text.includes('pupil-'), 'a pupil name leaked into the response')
})

test('a published outcome names the pupil and the receipt is whole', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1, true)]
  const out = JSON.parse((await run({}, parent, rows)).text)

  assert.match(String(out.draws[0].outcome.selected), /^pupil-/)
  assert.ok(out.draws[0].receipt.selectedValue)
})

test('the draw is still recomputable when the name is withheld', async () => {
  // The whole point: fairness does not need anybody's name.
  const rows = [await drawFor('12a@students.school.bg', 1, false)]
  const out = JSON.parse((await run({}, parent, rows)).text)

  assert.equal(out.draws[0].verification.valid, true)
  assert.ok(out.draws[0].youCanRecompute.some((s: string) => s.includes('ticket')))
})

test('what the parent cannot recompute is named, not glossed', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1, false)]
  const out = JSON.parse((await run({}, parent, rows)).text)

  assert.equal(out.draws[0].attestedByThisServer.length, 1)
  assert.match(out.draws[0].attestedByThisServer[0], /content address/)
})

test('a published draw leaves nothing merely attested', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1, true)]
  const out = JSON.parse((await run({}, parent, rows)).text)

  assert.deepEqual(out.draws[0].attestedByThisServer, [])
})

test('an unrevealed seed reports that nobody can check yet, not that it is valid', async () => {
  const draw = await drawFor('12a@students.school.bg', 1)
  const out = JSON.parse((await run({}, parent, [{ ...draw, serverSeed: null }])).text)

  assert.equal(out.draws[0].verification.valid, undefined)
  assert.match(out.draws[0].verification.reason, /not been revealed/)
})

test('the inclusion proof is hashes, never other receipts', async () => {
  const rows = [
    await drawFor('12a@students.school.bg', 1),
    await drawFor('12b@students.school.bg', 2),
    await drawFor('12c@students.school.bg', 3),
  ]
  const out = JSON.parse((await run({}, parent, rows)).text)
  const proof = out.draws[0].inclusion

  assert.ok(proof.path.length > 0, 'no proof was produced')
  for (const step of proof.path) {
    assert.match(step.hash, /^[0-9a-f]{64}$/)
    assert.ok(['left', 'right'].includes(step.side))
  }
  // A sibling hash is the mechanism; a sibling receipt would defeat it.
  assert.equal(JSON.stringify(proof).includes('selectedValue'), false)
})

test('the leaf set is read past the class gate, but never past the school', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1)]
  const { reads } = await run({}, parent, rows)

  const leafRead = reads.find(
    (r) => r.collection === 'random-selections' && r.overrideAccess === true,
  )
  assert.ok(leafRead, 'the leaf set was not read with access overridden')

  // Overridden past the class gate — that is what an inclusion proof needs —
  // but the tenant filter is applied by hand so it never reaches another school.
  assert.deepEqual((leafRead!.where as Record<string, unknown>).tenant, { equals: 1 })

  const scopedRead = reads.find(
    (r) => r.collection === 'random-selections' && r.overrideAccess === false,
  )
  assert.ok(scopedRead, 'the class read did not run under access control')
})

test('a class with no draws is an empty answer, not an error', async () => {
  const out = JSON.parse((await run({}, parent, [])).text)

  assert.deepEqual(out.draws, [])
  assert.match(out.note, /No draws recorded/)
})

test('the tool tells the parent how to check without this server', async () => {
  const rows = [await drawFor('12a@students.school.bg', 1)]
  const out = JSON.parse((await run({}, parent, rows)).text)

  assert.match(out.howToCheck, /verifyInclusion/)
  assert.match(out.howToCheck, /does not require this server|None of it requires this server/i)
})

test('the tool writes nothing and is offered to the audience it serves', () => {
  assert.equal(tool.writes, false)
  for (const role of ['parent', 'student', 'admin', 'registrar', 'teacher']) {
    assert.ok(tool.allowedRoles.includes(role as never), `${role} cannot reach it`)
  }
})

test('a tampered receipt does not verify, even unpublished', async () => {
  const draw = await drawFor('12a@students.school.bg', 1, false)
  draw.receipt.ticket = 0
  const { contentAddress: _drop, ...base } = draw.receipt
  draw.receipt.contentAddress = await contentAddressOf(base)

  const out = JSON.parse((await run({}, parent, [draw])).text)
  assert.equal(out.draws[0].verification.valid, false)
})
