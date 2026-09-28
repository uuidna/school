import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fakePayload, fakeRequest } from '../payload/testing.js'
import { complianceTools } from './compliance.js'

/**
 * `school_record_required_document` — the tool a school uses when it adopts or
 * replaces one of the acts its jurisdiction requires.
 *
 * It was covered by the aggregate folds and by no test that named it, and it
 * WRITES. Two of its properties decide whether a compliance report means
 * anything: recording a document twice under one title would let the legal
 * publication status match a superseded copy, and a document recorded without
 * the provision that requires it is a file on a shelf rather than an answer to
 * ЗПУО чл. 263.
 */
const tool = complianceTools.find((e) => e.name === 'school_record_required_document')!

const record = async (args: Record<string, unknown>, existing: Record<string, unknown>[] = []) => {
  const { calls, payload } = fakePayload({ docs: { documents: existing } })
  const result = await tool.handler(args, fakeRequest(payload) as never)
  return { calls, out: JSON.parse(result.content[0]!.text) }
}

const STRATEGY = { legalBasis: 'ЗПУО чл. 263, ал. 2, т. 1', title: 'Стратегия за развитие' }

test('a document the school has not recorded is created, with its provision', async () => {
  const { calls, out } = await record(STRATEGY)

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.op, 'create')
  assert.equal(out.action, 'created')
  assert.equal(out.legalBasis, STRATEGY.legalBasis, 'the provision travels back with the answer')
  assert.equal((calls[0]!.data as { legalBasis?: string }).legalBasis, STRATEGY.legalBasis)
})

// THE ONE THAT DECIDES WHETHER A COMPLIANCE REPORT MEANS ANYTHING. Adopting a
// replacement must update the record, not add a second one under the same
// title — two rows and the publication status can match the superseded copy.
test('re-adopting a document updates the record rather than adding a second', async () => {
  const { calls, out } = await record(
    { ...STRATEGY, link: 'https://school.bg/strategy-2027.pdf' },
    [{ id: 3, title: STRATEGY.title }],
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.op, 'update')
  assert.equal(calls[0]!.id, 3)
  assert.equal(out.action, 'updated')
})

test('the link is recorded when given, so the duty can actually be reached', async () => {
  const { calls } = await record({ ...STRATEGY, link: 'https://school.bg/s.pdf' })
  const data = calls[0]!.data as Record<string, unknown>
  assert.ok(
    JSON.stringify(data).includes('https://school.bg/s.pdf'),
    'a recorded document with no way to obtain it answers the duty on paper only',
  )
})

test('a document recorded without a link is still recorded', async () => {
  // "Adopted but not yet published" is a real state, and refusing it would push
  // a school into recording nothing at all.
  const { calls, out } = await record(STRATEGY)
  assert.equal(out.action, 'created')
  assert.ok(calls[0]!.data)
})

test('the provision is required — a document with no basis answers no duty', () => {
  const schema = tool.inputSchema as { required?: string[] }
  assert.deepEqual(schema.required?.slice().sort(), ['legalBasis', 'title'])
})

test('it declares that it writes, and who may', () => {
  assert.equal(tool.writes, true)
  assert.deepEqual(tool.allowedRoles, ['admin', 'registrar'])
  assert.deepEqual(tool.needs, ['documents'])
  for (const role of ['teacher', 'parent', 'student']) {
    assert.ok(!tool.allowedRoles.includes(role as never), `${role} does not adopt the school's statutory acts`)
  }
})
