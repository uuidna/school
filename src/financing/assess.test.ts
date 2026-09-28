import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Applicant, FinancingProgramme } from './types.js'

import { assess, assessAll, assessGuardianship } from './assess.js'

// UNDECIDABLE IS NOT "NO", AND IT IS CERTAINLY NOT "YES". Every test here is
// about the third outcome. An engine with two outcomes will always produce a
// confident answer, and a confident wrong answer about public money costs an
// applicant the grant and the work they put into it.

const provenance = { api: 'eu:funding-tenders', fetchedAt: '2026-09-20T00:00:00.000Z' }

const programme = (criteria: FinancingProgramme['criteria']): FinancingProgramme => ({
  authority: 'European Commission',
  criteria,
  id: 'test-programme',
  name: 'Test Programme',
  provenance,
})

const sizeAtLeast = (value: number) => ({
  describe: 'the institution teaches at least 100 pupils',
  field: 'pupilCount',
  id: 'size',
  op: 'gte' as const,
  value,
})

const inBulgaria = {
  describe: 'the applicant is established in Bulgaria',
  field: 'jurisdiction',
  id: 'place',
  op: 'eq' as const,
  value: 'bg',
}

const school = (over: Record<string, unknown> = {}): Applicant =>
  ({ jurisdiction: 'bg', kind: 'institution', pupilCount: 420, ...over }) as Applicant

test('an applicant meeting every criterion is eligible', async () => {
  const result = await assess(programme([inBulgaria, sizeAtLeast(100)]), school())

  assert.equal(result.eligible, true)
  assert.equal(result.met.length, 2)
})

test('a criterion the applicant fails makes them ineligible, and names it', async () => {
  const result = await assess(programme([sizeAtLeast(1000)]), school())

  assert.equal(result.eligible, false)
  assert.match(result.unmet[0]!.reason, /at least 100 pupils/)
  assert.match(result.unmet[0]!.reason, /420/)
})

test('an unstated field is undecidable, not a failure', async () => {
  const result = await assess(programme([sizeAtLeast(100)]), school({ pupilCount: undefined }))

  assert.equal(result.eligible, undefined, 'must not be false — the school never said')
  assert.equal(result.undecidable.length, 1)
  assert.match(result.undecidable[0]!.reason, /has not stated pupilCount/)
})

test('one undecidable criterion makes the whole verdict undecidable', async () => {
  const result = await assess(
    programme([inBulgaria, sizeAtLeast(100)]),
    school({ pupilCount: undefined }),
  )

  assert.equal(result.met.length, 1)
  assert.equal(result.eligible, undefined)
})

test('a definite failure outranks an undecidable — the answer is still no', async () => {
  const result = await assess(
    programme([{ ...inBulgaria, value: 'gr' }, sizeAtLeast(100)]),
    school({ pupilCount: undefined }),
  )

  assert.equal(result.eligible, false)
})

test('an operator this build does not know is undecidable, never a refusal', async () => {
  // A newer programme must not read as "not eligible" on an older engine.
  const result = await assess(
    programme([{ ...sizeAtLeast(100), op: 'between' as never }]),
    school(),
  )

  assert.equal(result.eligible, undefined)
  assert.equal(result.undecidable.length, 1)
})

test('a programme with no provenance is refused, not evaluated', async () => {
  const invented = { ...programme([inBulgaria]), provenance: undefined as never }

  await assert.rejects(() => assess(invented, school()), /no provenance/)
})

test('attributes cannot overwrite a declared field', async () => {
  // Otherwise a free-form attribute silently re-answers a decided criterion.
  const result = await assess(
    programme([inBulgaria]),
    school({ attributes: { jurisdiction: 'gr' } }),
  )

  assert.equal(result.eligible, true)
})

test('an adult researcher applying alone needs no guardian', async () => {
  const result = await assess(programme([inBulgaria]), {
    isMinor: false,
    jurisdiction: 'bg',
    kind: 'researcher',
  })

  assert.equal(result.guardianship?.required, false)
  assert.equal(result.eligible, true)
})

test('a minor with recorded guardian consent may apply', async () => {
  const result = await assess(programme([inBulgaria]), {
    guardianConsent: { at: '2026-09-01', evidencedBy: '12a@parents.school.bg' },
    isMinor: true,
    jurisdiction: 'bg',
    kind: 'researcher',
  })

  assert.equal(result.guardianship?.satisfied, true)
  assert.equal(result.eligible, true)
})

test('a minor whose consent was never sought is undecided, not refused', async () => {
  // Supporting researchers whatever their age means not slamming the door on a
  // child because nobody has asked the question yet.
  const result = await assess(programme([inBulgaria]), {
    isMinor: true,
    jurisdiction: 'bg',
    kind: 'researcher',
  })

  assert.equal(result.guardianship?.satisfied, undefined)
  assert.equal(result.eligible, undefined)
})

test('a minor with consent explicitly absent is refused', async () => {
  const result = await assess(programme([inBulgaria]), {
    guardianConsent: null,
    isMinor: true,
    jurisdiction: 'bg',
    kind: 'researcher',
  })

  assert.equal(result.guardianship?.satisfied, false)
  assert.equal(result.eligible, false)
})

test('age is not required to settle guardianship', async () => {
  // Collecting a birthday to decide a question isMinor already answers is the
  // collection art. 5(1)(c) forbids.
  const stated = assessGuardianship({ isMinor: false, kind: 'researcher' })

  assert.equal(stated?.satisfied, true)
  assert.equal(stated?.required, false)
})

test('an applicant who states neither age nor isMinor is undecided', async () => {
  const result = assessGuardianship({ kind: 'researcher' })

  assert.equal(result?.satisfied, undefined)
  assert.match(result!.reason, /state isMinor/)
})

test('institutions are not asked about guardianship at all', async () => {
  assert.equal((await assess(programme([inBulgaria]), school())).guardianship, undefined)
})

test('assessAll puts decided eligibility before open questions before refusals', async () => {
  const ranked = await assessAll(
    [
      { ...programme([{ ...inBulgaria, value: 'gr' }]), id: 'no' },
      { ...programme([sizeAtLeast(100)]), id: 'unknown' },
      { ...programme([inBulgaria]), id: 'yes' },
    ],
    school({ pupilCount: undefined }),
  )

  assert.deepEqual(ranked.map((r) => r.programme.id), ['yes', 'unknown', 'no'])
})
