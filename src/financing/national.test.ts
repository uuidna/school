import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NationalCatalogue } from './national.js'

import { assess } from './assess.js'
import { applicationPlan } from './readiness.js'
import { loadNationalProgrammes, staleness } from './national.js'

// THE STATE DOES NOT PUBLISH THESE AS DATA. Bulgaria's национални програми are
// approved by a Council of Ministers decision and published as documents; the
// open-data portal does not carry them and strategy.bg offers no feed. So the
// catalogue is declared, and the one thing that makes a declared catalogue
// trustworthy is that it names the act which approved it — and that it says
// how old it is, because these are revised every year.

const catalogue = (over: Partial<NationalCatalogue> = {}): NationalCatalogue => ({
  approvedBy: {
    act: 'РМС № 278 от 09.04.2026 г.',
    date: '2026-04-09',
    url: 'https://www.mon.bg/dokumentatsiya/programi-i-proekti/naczionalni-programi-2026/',
  },
  authority: 'Министерство на образованието и науката',
  jurisdiction: 'bg',
  programmes: [
    { id: 'np-2026-02', name: 'НП „Ученически олимпиади и състезания“' },
    {
      closes: '2026-11-30',
      id: 'np-2026-05',
      name: 'НП „Информационни и комуникационни технологии“',
      opens: '2026-05-01',
    },
  ],
  year: 2026,
  ...over,
})

const NOW = new Date('2026-09-20T00:00:00.000Z')

test('a catalogue with no approving act is refused', async () => {
  // Indistinguishable from a list somebody typed from memory.
  await assert.rejects(
    () => loadNationalProgrammes(catalogue({ approvedBy: { act: '  ', date: '2026-04-09' } }), NOW),
    /no approving act/,
  )
})

test('an act with no readable date is refused', async () => {
  await assert.rejects(
    () => loadNationalProgrammes(catalogue({ approvedBy: { act: 'РМС № 278', date: 'April' } }), NOW),
    /no readable date/,
  )
})

test('an empty catalogue is refused rather than returning nothing', async () => {
  // Nothing and "the state funds nothing" look identical to a caller.
  await assert.rejects(() => loadNationalProgrammes(catalogue({ programmes: [] }), NOW), /no programmes/)
})

test('each programme cites the act that approved it', async () => {
  const [first] = await loadNationalProgrammes(catalogue(), NOW)

  assert.equal(first!.provenance.api, 'national:bg')
  assert.equal(first!.provenance.reference, 'РМС № 278 от 09.04.2026 г.')
  assert.equal(first!.basis, 'РМС № 278 от 09.04.2026 г.')
  assert.match(first!.provenance.url!, /mon\.bg/)
})

test('a catalogue is as fresh as its approval, not as the moment it was read', async () => {
  const [first] = await loadNationalProgrammes(catalogue(), NOW)

  assert.equal(first!.provenance.fetchedAt, new Date('2026-04-09').toISOString())
})

test('a published window is carried; an absent one is not invented', async () => {
  const [olympiads, ict] = await loadNationalProgrammes(catalogue(), NOW)

  assert.equal(olympiads!.window, undefined)
  assert.equal(ict!.window!.opens, '2026-05-01')
  assert.equal(ict!.window!.closes, '2026-11-30')
})

test('eligibility is never claimed from a programme published as prose', async () => {
  const [first] = await loadNationalProgrammes(catalogue(), NOW)
  const verdict = await assess(first!, { jurisdiction: 'bg', kind: 'institution' })

  assert.equal(first!.criteria.length, 0)
  assert.equal(verdict.eligible, undefined, 'an unread programme was reported as eligible')
  assert.match(verdict.undecidable[0]!.reason, /prose/)
})

test("last year's catalogue is reported stale, not silently used", () => {
  // National programmes are revised annually; a 2025 list read in 2026
  // describes programmes that may no longer exist.
  const old = catalogue({ year: 2025 })
  const age = staleness(old, NOW)

  assert.equal(age.stale, true)
  assert.equal(age.behind, 1)
  assert.match(age.reason, /superseded/)
})

test('staleness reaches the applicant, not just the log', async () => {
  const [first] = await loadNationalProgrammes(catalogue({ year: 2025 }), NOW)
  const verdict = await assess(first!, { kind: 'institution' })

  assert.match(verdict.undecidable[0]!.reason, /revised annually|superseded/)
})

test('a current catalogue is not flagged', async () => {
  assert.equal(staleness(catalogue(), NOW).stale, false)
  assert.equal(staleness(catalogue({ year: 2027 }), NOW).stale, false, 'next year is not stale')
})

test('a stale catalogue is still loaded — the school decides, having been told', async () => {
  // Refusing outright would leave a school with nothing during the weeks
  // between one act lapsing and the next being adopted.
  const loaded = await loadNationalProgrammes(catalogue({ year: 2025 }), NOW)
  assert.equal(loaded.length, 2)
})

test('the plan names the open question rather than claiming a fit', async () => {
  const [, ict] = await loadNationalProgrammes(catalogue(), NOW)
  const plan = await applicationPlan(ict!, { jurisdiction: 'bg', kind: 'institution' }, [], NOW)

  assert.equal(plan.window.open, true)
  assert.match(plan.blocking!, /undecided/)
})

test('a national programme and an EU call are the same shape to the engine', async () => {
  // The point of the port: one engine, many authorities.
  const [first] = await loadNationalProgrammes(catalogue(), NOW)

  assert.equal(typeof first!.id, 'string')
  assert.equal(typeof first!.authority, 'string')
  assert.ok(first!.provenance.api.startsWith('national:'))
  assert.ok(Array.isArray(first!.criteria))
})
