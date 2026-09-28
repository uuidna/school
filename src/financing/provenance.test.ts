import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FinancingProgramme } from './types.js'

import { assess } from './assess.js'
import { programmeAddress, sealProgramme, verifyProgramme } from './provenance.js'

// PROVENANCE THAT CAN BE CHECKED RATHER THAN READ. The block carried four
// strings and the engine asked only whether they were present — whether the
// label was there, never whether it was true of the record underneath it. A
// deadline edited after the load kept its provenance intact and went on being
// evaluated as though the portal had published it that way.

const school = { jurisdiction: 'bg', kind: 'institution' } as const

const loaded = (over: Partial<FinancingProgramme> = {}): FinancingProgramme => ({
  authority: 'European Commission',
  conditionsUnparsed: { reason: 'the portal publishes this as prose', url: 'https://x' },
  criteria: [
    { describe: 'applicants in Bulgaria', field: 'jurisdiction', id: 'bg', op: 'eq', value: 'bg' },
  ],
  id: 'LIFE-2026-SAP-NAT-NATURE',
  name: 'Nature and Biodiversity',
  provenance: { api: 'eu:funding-tenders', fetchedAt: '2026-09-20T00:00:00.000Z' },
  window: { closes: '2026-11-04' },
  ...over,
})

test('a sealed record verifies against itself', async () => {
  const check = await verifyProgramme(await sealProgramme(loaded()))

  assert.equal(check.verified, true)
})

test('a moved deadline is arithmetic, not opinion', async () => {
  // The change this exists for: the window a school plans around, edited
  // after the load, with the provenance block left intact.
  const sealed = await sealProgramme(loaded())
  const moved = { ...sealed, window: { closes: '2026-12-31' } }

  const check = await verifyProgramme(moved)
  assert.equal(check.verified, false)
  assert.match(check.reason, /changed since it was read from eu:funding-tenders/)
})

test('a removed condition is caught, and so is a changed comparison', async () => {
  const sealed = await sealProgramme(loaded())

  assert.equal((await verifyProgramme({ ...sealed, criteria: [] })).verified, false)
  assert.equal(
    (
      await verifyProgramme({
        ...sealed,
        criteria: [{ ...sealed.criteria[0]!, op: 'ne' as never }],
      })
    ).verified,
    false,
  )
})

test('the marker that the conditions are unread cannot be quietly dropped', async () => {
  // Dropping it is what turned a stored EU call into "eligible for everybody".
  const sealed = await sealProgramme(loaded())
  const { conditionsUnparsed: _dropped, ...without } = sealed

  assert.equal((await verifyProgramme(without as FinancingProgramme)).verified, false)
})

test('a record with no address is undecidable here, never "unchanged"', async () => {
  // Entered by hand, or loaded before addresses were sealed. Neither is a
  // forgery, and neither is verified.
  const check = await verifyProgramme(loaded())

  assert.equal(check.verified, undefined)
  assert.match(check.reason, /cannot be decided here/)
})

test('an altered record is refused by the engine, harder than an unprovenanced one', async () => {
  // One makes no claim about where it came from; the other makes a claim its
  // own contents contradict.
  const sealed = await sealProgramme(loaded())
  const moved = { ...sealed, window: { closes: '2026-12-31' } }

  await assert.rejects(() => assess(moved, school), /not admissible/)
  // And the honest case still runs, reporting what it could check.
  assert.equal((await assess(sealed, school)).provenanceVerified, true)
  assert.equal((await assess(loaded(), school)).provenanceVerified, undefined)
})

test('reading a record twice is not a change to it', async () => {
  // fetchedAt moves on every re-read and is not part of the record: an
  // address that included it would report every catalogue refresh as tampering.
  const first = await sealProgramme(loaded())
  const second = await sealProgramme(
    loaded({ provenance: { api: 'eu:funding-tenders', fetchedAt: '2026-10-01T00:00:00.000Z' } }),
  )

  assert.equal(first.provenance.contentAddress, second.provenance.contentAddress)
})

test('the same instant written two ways is the same record', async () => {
  // A window stored as a date comes back as an ISO instant. A check that
  // cried tampering at that would be disbelieved the one time it meant it.
  const published = await programmeAddress(loaded({ window: { closes: '2026-11-04' } }))
  const storedBack = await programmeAddress(
    loaded({ window: { closes: '2026-11-04T00:00:00.000Z' } }),
  )

  assert.equal(published, storedBack)
})

test('key order a database happened to return is not a change either', async () => {
  const forwards = loaded()
  const shuffled: FinancingProgramme = {
    window: forwards.window,
    provenance: forwards.provenance,
    name: forwards.name,
    id: forwards.id,
    criteria: forwards.criteria.map((criterion) => ({
      value: criterion.value,
      op: criterion.op,
      id: criterion.id,
      field: criterion.field,
      describe: criterion.describe,
    })),
    conditionsUnparsed: forwards.conditionsUnparsed,
    authority: forwards.authority,
  }

  assert.equal(await programmeAddress(forwards), await programmeAddress(shuffled))
})

// THE NORMAL FORM'S OWN CLAIMS, which were prose until this block. Two of
// them held; one did not, and the one that did not would have accused a host
// of tampering with a record nobody had touched.

test('two conditions in the other order are the same record', async () => {
  // Measured before it was decided: assess evaluates every criterion and
  // combines the verdicts, so the order of independent conditions changes no
  // eligibility. Keeping order in the address therefore bought nothing and
  // risked refusing a catalogue a store had merely returned differently.
  const second = {
    describe: 'in this region',
    field: 'region',
    id: 'region',
    op: 'eq' as const,
    value: 'bg-01',
  }
  const forwards = loaded({ criteria: [loaded().criteria[0]!, second] })
  const backwards = loaded({ criteria: [second, loaded().criteria[0]!] })

  assert.equal(await programmeAddress(forwards), await programmeAddress(backwards))

  // And the eligibility they decide is the same, which is why this is safe.
  const applicant = { jurisdiction: 'bg', kind: 'institution' as const, region: 'bg-01' }
  assert.equal(
    (await assess(await sealProgramme(forwards), applicant)).eligible,
    (await assess(await sealProgramme(backwards), applicant)).eligible,
  )
})

test('two required documents in the other order are the same record', async () => {
  const a = { match: 'устав', name: 'Устав' }
  const b = { match: 'стратегия', name: 'Стратегия' }

  assert.equal(
    await programmeAddress(loaded({ requires: [a, b] })),
    await programmeAddress(loaded({ requires: [b, a] })),
  )
})

test('but two stages in the other order are a different process', async () => {
  // The exception, and the reason the sort is per-field rather than blanket:
  // a two-stage call assessed in reverse is not the same programme.
  assert.notEqual(
    await programmeAddress(loaded({ workflow: ['stage 1', 'stage 2'] })),
    await programmeAddress(loaded({ workflow: ['stage 2', 'stage 1'] })),
  )
})

test('whitespace is not a change, and neither is absent versus empty', async () => {
  const plain = loaded()

  assert.equal(
    await programmeAddress(plain),
    await programmeAddress(loaded({ authority: '  European Commission  ' })),
  )
  // A field the store writes as an empty string and one it omits entirely.
  assert.equal(
    await programmeAddress(plain),
    await programmeAddress(loaded({ basis: '' })),
  )
  // And an empty window is no window, not a window at the epoch.
  assert.equal(
    await programmeAddress(loaded({ window: undefined })),
    await programmeAddress(loaded({ window: {} })),
  )
})

test('a renamed authority is still caught, so the sorting did not blunt it', async () => {
  // The guard against over-normalising: every relaxation above must leave the
  // changes that alter a decision detectable.
  const sealed = await sealProgramme(loaded())

  assert.equal((await verifyProgramme({ ...sealed, authority: 'Someone Else' })).verified, false)
  assert.equal((await verifyProgramme({ ...sealed, name: 'Another Call' })).verified, false)
  assert.equal(
    (await verifyProgramme({ ...sealed, requires: [{ match: 'x', name: 'X' }] })).verified,
    false,
  )
})
