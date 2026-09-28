import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { UserVersion } from './versions.js'

import { accessChangesFromVersions } from './versions.js'

const v = (role: null | string, at: string, extra: Partial<UserVersion['version']> = {}): UserVersion => ({
  updatedAt: at,
  version: { email: 'teacher@school.bg', role, ...extra },
})

test('a role change between adjacent versions is one access change', () => {
  const changes = accessChangesFromVersions([
    v('registrar', '2027-03-02T10:00:00Z', { accessChangedBy: 'head@school.bg', accessReason: 'covering admissions while N is on leave' }),
    v('teacher', '2027-01-04T09:00:00Z'),
  ])

  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0], {
    action: 'grant',
    actor: 'head@school.bg',
    at: '2027-03-02T10:00:00Z',
    reason: 'covering admissions while N is on leave',
    subject: 'teacher@school.bg',
  })
})

test('a fall to the floor is a revoke, matching what the tools do', () => {
  const changes = accessChangesFromVersions([
    v('student', '2027-06-30T16:00:00Z', { accessChangedBy: 'head@school.bg', accessReason: 'left the school at the end of term' }),
    v('teacher', '2026-09-01T08:00:00Z'),
  ])
  assert.equal(changes[0]!.action, 'revoke')
})

// ONLY ROLE CHANGES ARE ACCESS CHANGES. A user editing their own name makes a
// version and no access change; reporting it would bury the entries an
// inspection looks for under a thousand that answer nothing.
test('a version with no role change yields nothing', () => {
  const changes = accessChangesFromVersions([
    { updatedAt: '2027-03-02T10:00:00Z', version: { email: 'a@b.bg', role: 'teacher' } },
    { updatedAt: '2027-03-01T10:00:00Z', version: { email: 'a@b.bg', role: 'teacher' } },
  ])
  assert.deepEqual(changes, [])
})

// THE OLDEST VERSION HAS NO PREDECESSOR, so the role it carries is where the
// account started, not a change to it. Reporting it as a grant would invent an
// event that never happened — and an invented entry in an audit trail is worse
// than a missing one.
test('the first recorded state is not reported as a grant', () => {
  assert.deepEqual(accessChangesFromVersions([v('teacher', '2026-09-01T08:00:00Z')]), [])
})

test('before and after are DERIVED — a stored pair could disagree with the history', () => {
  // Three versions, two changes, computed from adjacency rather than from
  // anything written at the time.
  const changes = accessChangesFromVersions([
    v('student', '2027-06-30T16:00:00Z', { accessChangedBy: 'head', accessReason: 'left' }),
    v('registrar', '2027-03-02T10:00:00Z', { accessChangedBy: 'head', accessReason: 'cover' }),
    v('teacher', '2026-09-01T08:00:00Z'),
  ])
  assert.deepEqual(changes.map((c) => c.action), ['revoke', 'grant'])
  assert.deepEqual(changes.map((c) => c.at), ['2027-06-30T16:00:00Z', '2027-03-02T10:00:00Z'])
})

// A CHANGE WITH NO REASON IS STILL RECORDED — as a change with no reason.
// Dropping it would hide the one thing an inspection looks for.
test('a change made without a reason is reported, with the reason null', () => {
  const changes = accessChangesFromVersions([
    v('admin', '2027-03-02T10:00:00Z', { accessChangedBy: 'script' }),
    v('teacher', '2026-09-01T08:00:00Z'),
  ])
  assert.equal(changes[0]!.reason, null)
  assert.equal(changes[0]!.actor, 'script')
})

test('an actor Payload could not name is "unknown", never blank', () => {
  const changes = accessChangesFromVersions([
    v('admin', '2027-03-02T10:00:00Z'),
    v('teacher', '2026-09-01T08:00:00Z'),
  ])
  assert.equal(changes[0]!.actor, 'unknown')
})
