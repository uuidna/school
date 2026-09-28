import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SchoolDocument } from '../sources/types.js'
import type { Applicant, FinancingProgramme } from './types.js'

import { applicationPlan, documentReadiness, windowState } from './readiness.js'

// ELIGIBLE IS NOT THE SAME AS ABLE. A school may qualify and still be unable to
// apply, and "no window published" is not "open". Every default here points the
// same way: toward telling the applicant something is unresolved, rather than
// sending them at a door that is shut.

const provenance = { api: 'eu:funding-tenders', fetchedAt: '2026-09-20T00:00:00.000Z' }
const NOW = new Date('2026-09-20T12:00:00.000Z')

const programme = (over: Partial<FinancingProgramme> = {}): FinancingProgramme => ({
  authority: 'European Commission',
  // A published condition, because a programme with none recorded is
  // undecidable now and would block every plan below on that rather than on
  // what each test is about.
  criteria: [
    { describe: 'applicants in Bulgaria', field: 'jurisdiction', id: 'bg', op: 'eq', value: 'bg' },
  ],
  id: 'p',
  name: 'Programme',
  provenance,
  ...over,
})

const school: Applicant = { jurisdiction: 'bg', kind: 'institution' }

const doc = (title: string, reachable: boolean): SchoolDocument => ({
  id: title,
  reachable,
  title,
})

test('an unpublished window is undecided, never open', async () => {
  const state = windowState(programme(), NOW)

  assert.equal(state.open, undefined)
  assert.match(state.reason, /no application window/)
})

test('a window is open between its dates and closed outside them', async () => {
  const open = { closes: '2026-12-01', opens: '2026-01-01' }
  assert.equal(windowState(programme({ window: open }), NOW).open, true)

  const past = { closes: '2026-01-31', opens: '2026-01-01' }
  assert.equal(windowState(programme({ window: past }), NOW).open, false)

  const future = { opens: '2027-01-01' }
  assert.equal(windowState(programme({ window: future }), NOW).open, false)
})

test('an unreadable date is undecided, not open', async () => {
  const state = windowState(programme({ window: { closes: 'whenever' } }), NOW)

  assert.equal(state.open, undefined)
  assert.match(state.reason, /could not be read/)
})

test('a recorded document that cannot be obtained is not ready', async () => {
  const required = [{ match: 'устав', name: 'Устав' }]
  const [entry] = documentReadiness(programme({ requires: required }), [doc('Устав', false)])

  assert.equal(entry!.status, 'recorded-only')
})

test('a document the authority accepts as a declaration is ready without a file', async () => {
  const required = [{ match: 'устав', mustBeObtainable: false, name: 'Устав' }]
  const [entry] = documentReadiness(programme({ requires: required }), [doc('Устав', false)])

  assert.equal(entry!.status, 'ready')
})

test('an obtainable document is preferred over a recorded one with the same title', async () => {
  const required = [{ match: 'устав', name: 'Устав' }]
  const [entry] = documentReadiness(programme({ requires: required }), [
    doc('Устав (проект)', false),
    doc('Устав', true),
  ])

  assert.equal(entry!.status, 'ready')
  assert.equal(entry!.document!.title, 'Устав')
})

test('a missing document is missing, not merely unready', async () => {
  const required = [{ match: 'устав', name: 'Устав' }]
  const [entry] = documentReadiness(programme({ requires: required }), [])

  assert.equal(entry!.status, 'missing')
  assert.equal(entry!.document, undefined)
})

test('the plan names one next action, not a list', async () => {
  const plan = await applicationPlan(
    programme({
      requires: [{ match: 'устав', name: 'Устав' }, { match: 'бюджет', name: 'Бюджет' }],
      window: { closes: '2026-12-01' },
    }),
    school,
    [],
    NOW,
  )

  assert.equal(typeof plan.blocking, 'string')
  assert.match(plan.blocking!, /Устав/)
})

test('a closed window blocks before any paperwork is demanded', async () => {
  const plan = await applicationPlan(
    programme({
      requires: [{ match: 'устав', name: 'Устав' }],
      window: { closes: '2026-01-31' },
    }),
    school,
    [],
    NOW,
  )

  assert.match(plan.blocking!, /not open/)
})

test("a minor's guardian is settled before documents are assembled in their name", async () => {
  const plan = await applicationPlan(
    programme({
      requires: [{ match: 'устав', name: 'Устав' }],
      window: { closes: '2026-12-01' },
    }),
    { isMinor: true, jurisdiction: 'bg', kind: 'researcher' },
    [],
    NOW,
  )

  assert.match(plan.blocking!, /guardian consent/)
})

test('nothing blocking is reported as nothing, not as an empty string', async () => {
  const plan = await applicationPlan(
    programme({
      requires: [{ match: 'устав', name: 'Устав' }],
      window: { closes: '2026-12-01' },
    }),
    school,
    [doc('Устав', true)],
    NOW,
  )

  assert.equal(plan.blocking, null)
})

test('an applicant with everything but no published window is still told so', async () => {
  const plan = await applicationPlan(programme(), school, [], NOW)

  assert.match(plan.blocking!, /no published window/)
})

test('stages come from the authority, and are empty when it published none', async () => {
  assert.deepEqual((await applicationPlan(programme(), school, [], NOW)).stages, [])
  assert.deepEqual(
    (await applicationPlan(programme({ workflow: ['submit', 'assess'] }), school, [], NOW)).stages,
    ['submit', 'assess'],
  )
})
