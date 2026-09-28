import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fakePayload, fakeRequest } from '../payload/testing.js'
import { complianceTools } from './compliance.js'

/**
 * `school_data_protection_report` — the tool an inspection actually opens.
 *
 * It was covered by the aggregate folds and by no test that named it, which is
 * the weakest place in the catalogue for that to be true: it is the answer to
 * "who can see pupils' data, and why was each of them given it", and art. 5(2)
 * of Regulation (EU) 2016/679 asks the controller to DEMONSTRATE the why.
 */
const tool = complianceTools.find((entry) => entry.name === 'school_data_protection_report')!

const USERS = [
  { email: 'head@school.bg', id: 1, role: 'admin' },
  { email: 'reg@school.bg', id: 2, role: 'registrar' },
  { email: 't1@school.bg', id: 3, role: 'teacher' },
  { email: 't2@school.bg', id: 4, role: 'teacher' },
  { email: 'p1@school.bg', id: 5, role: 'parent' },
  { email: 's1@school.bg', id: 6, role: 'student' },
]

const report = async (versions: Record<string, unknown>[] = [], total = versions.length) => {
  const { payload } = fakePayload({ counts: { users: total }, docs: { users: USERS }, versions })
  return JSON.parse((await tool.handler({}, fakeRequest(payload) as never)).content[0]!.text)
}

const version = (role: string, at: string, extra: Record<string, unknown> = {}) => ({
  updatedAt: at,
  version: { email: 't1@school.bg', role, ...extra },
})

test('roles are counted from the people, not from a figure kept beside them', async () => {
  const out = await report()
  assert.deepEqual(out.roleCounts, { admin: 1, parent: 1, registrar: 1, student: 1, teacher: 2 })
})

// THE NUMBER AN INSPECTION ASKS FOR FIRST. Staff reach pupils' records; parents
// and pupils do not, and counting them in would overstate the exposure.
test('staff with access to pupil data is the staff count, not everyone', async () => {
  const out = await report()
  assert.equal(out.staffWithPupilDataAccess, 4, 'admin, registrar and two teachers — not the parent or the pupil')
})

test('the report names its jurisdiction and its retention rule', async () => {
  const out = await report()
  assert.ok(out.dataProtectionRegime, 'the regime is stated, not assumed')
  assert.ok(out.jurisdiction.code, 'and which jurisdiction answered')
  assert.ok(out.auditRetentionDays > 0, 'retention is a number somebody can check against a law')
})

// ART. 5(2) IS THE WHOLE POINT: a change with no stated reason is the finding,
// so it is counted separately rather than folded into the total.
test('changes made without a stated reason are counted apart from the rest', async () => {
  const out = await report([
    version('registrar', '2027-03-02T10:00:00Z', { accessChangedBy: 'head@school.bg', accessReason: 'covering admissions' }),
    version('teacher', '2027-02-01T09:00:00Z', { accessChangedBy: 'head@school.bg' }),
    version('student', '2026-09-01T08:00:00Z'),
  ])

  assert.equal(out.recentAccessChanges.length, 2, 'two role changes across three snapshots')
  assert.equal(out.changesWithoutStatedReason, 1, 'one of them states no reason')
})

test('a school with no access changes reports zero, not an absent field', async () => {
  const out = await report([], 0)
  assert.equal(out.changesWithoutStatedReason, 0)
  assert.equal(out.recentAccessChangesShown, 0)
  assert.deepEqual(out.recentAccessChanges, [])
})

// THE WINDOW IS DECLARED. A report showing twenty of two thousand changes while
// implying it showed all of them is worse than one that shows none.
test('the window is stated alongside the total it is a window onto', async () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    version(i % 2 === 0 ? 'teacher' : 'registrar', `2027-01-${String((i % 28) + 1).padStart(2, '0')}T09:00:00Z`, {
      accessChangedBy: 'head@school.bg',
      accessReason: 'rota',
    }),
  )
  const out = await report(many, 500)

  // THE TOTAL IS DERIVED, NOT COUNTED. Since the access trail became version
  // history there is no row to count: a change is a difference between adjacent
  // snapshots, so forty versions yield thirty-nine changes and the `count`
  // figure the store would report is irrelevant. The report says what it can
  // derive, which is the only number that means anything here.
  assert.equal(out.accessChangesRecorded, 39, 'forty snapshots, thirty-nine differences between them')
  assert.ok(out.recentAccessChangesShown <= 20, 'and the window is at most twenty')
  assert.ok(out.recentAccessChanges.length <= 20)
  assert.ok(
    out.accessChangesRecorded > out.recentAccessChangesShown,
    'the window is smaller than the total, and the report states both — one number alone would imply it showed everything',
  )
})

// NO PUPIL RECORD LEAVES THROUGH THIS TOOL. It names which collections hold
// personal data and returns none of it — art. 5(1)(c), minimisation.
test('personal data is named, never returned', async () => {
  const out = await report()
  assert.ok(Array.isArray(out.personalDataCollections.pupilRecords))
  assert.match(out.personalDataCollections.note, /minimisation/)

  const body = JSON.stringify(out)
  for (const pupil of ['s1@school.bg', 'p1@school.bg']) {
    assert.ok(!body.includes(pupil), `${pupil} appears in a report that must not carry pupil identities`)
  }
})

test('only an admin may ask — the report is the access surface it describes', () => {
  assert.deepEqual(tool.allowedRoles, ['admin'])
  assert.equal(tool.writes, false)
})
