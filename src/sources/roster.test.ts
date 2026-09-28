import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickWeighted } from '../fair/draw.js'
import { handleFor, rosterHashOfHandles, sealRoster, verifyRoster } from './roster.js'

// A ROSTER LEAVES A SOURCE PSEUDONYMOUS OR IT DOES NOT LEAVE. Every adapter
// goes through sealRoster, so these are the properties the whole package's
// roster reading rests on — and the last test is why the shape was chosen: a
// draw over a sealed roster and the roster itself commit to the same value,
// so a parent can check a draw ran over their child's class without being
// shown anybody in it.

const klass = { id: '12a@students.school.bg', name: '12a' }

test('the same member in the same class is the same handle every time', async () => {
  // A receipt written last term has to still verify this term.
  const once = await handleFor('12a', 'user-1')
  const again = await handleFor('12a', 'user-1')

  assert.equal(once, again)
  assert.match(once, /^[0-9a-f]{32}$/)
})

test('the same child in two classes has two unrelated handles', async () => {
  // Otherwise two rosters join into that child's timetable, which is more
  // than either roster was read for.
  const inMaths = await handleFor('maths-7', 'user-1')
  const inMusic = await handleFor('music-7', 'user-1')

  assert.notEqual(inMaths, inMusic)
})

test('a handle carries neither the id it came from nor the class', async () => {
  const handle = await handleFor('12a@students.school.bg', 'anna.petrova')

  assert.ok(!handle.includes('anna'))
  assert.ok(!handle.includes('12a'))
})

test('a roster is ordered by handle, not by the order it arrived', async () => {
  // The commitment must not depend on how a source paged, and enrolment
  // order is itself information about children — who joined mid-year.
  const forwards = await sealRoster(klass, [
    { id: 'a', role: 'student' },
    { id: 'b', role: 'student' },
    { id: 'c', role: 'student' },
  ])
  const backwards = await sealRoster(klass, [
    { id: 'c', role: 'student' },
    { id: 'b', role: 'student' },
    { id: 'a', role: 'student' },
  ])

  assert.deepEqual(forwards.members, backwards.members)
  assert.equal(forwards.rosterHash, backwards.rosterHash)
  assert.deepEqual(
    forwards.members.map((member) => member.handle),
    forwards.members.map((member) => member.handle).slice().sort(),
  )
})

test('a parent is not a member of their child’s class', async () => {
  // Both Workspace and the local store carry a parent under their child's
  // class. A parent left in the candidate list is a draw that can select an
  // adult for a pupil's place.
  const roster = await sealRoster(klass, [
    { id: 'pupil-1', role: 'student' },
    { id: 'parent-of-1', role: 'parent' },
    { id: 'teacher-1', role: 'teacher' },
  ])

  assert.equal(roster.members.length, 2)
  assert.equal(roster.class.students, 1)
  assert.equal(roster.class.teachers, 1)
})

test('the counts are taken from the roster that was sealed', async () => {
  // A source's own figure can be stale; the list cannot disagree with itself.
  const roster = await sealRoster(
    { ...klass, students: 99, teachers: 99 },
    [
      { id: 'p1', role: 'student' },
      { id: 'p2', role: 'student' },
    ],
  )

  assert.equal(roster.class.students, 2)
  assert.equal(roster.class.teachers, 0)
})

test('teachers are not candidates in the commitment', async () => {
  const withTeacher = await sealRoster(klass, [
    { id: 'p1', role: 'student' },
    { id: 't1', role: 'teacher' },
  ])
  const without = await sealRoster(klass, [{ id: 'p1', role: 'student' }])

  // The teacher is in the roster and not in what a draw runs over.
  assert.equal(withTeacher.members.length, 2)
  assert.equal(withTeacher.rosterHash, without.rosterHash)
})

test('one pupil more is a different commitment', async () => {
  const before = await sealRoster(klass, [{ id: 'p1', role: 'student' }])
  const after = await sealRoster(klass, [
    { id: 'p1', role: 'student' },
    { id: 'p2', role: 'student' },
  ])

  assert.notEqual(before.rosterHash, after.rosterHash)
})

test('a draw over the class commits to the same roster the class reports', async () => {
  // The join. Without this the two halves could drift and nothing would say
  // so: a receipt would carry a commitment no roster read could reproduce,
  // and a parent checking one against the other would be told the draw was
  // over some other class.
  const roster = await sealRoster(klass, [
    { id: 'p1', role: 'student' },
    { id: 'p2', role: 'student' },
    { id: 't1', role: 'teacher' },
  ])

  const candidates = roster.members
    .filter((member) => member.role === 'student')
    .map((member) => ({ value: member.handle, weight: 1 }))

  const drawn = await pickWeighted('server-seed', 'round-1', candidates)

  assert.equal(drawn.receipt.rosterHash, roster.rosterHash)
  // And the winner is a handle, so publishing the receipt names nobody.
  assert.match(String(drawn.result), /^[0-9a-f]{32}$/)
})

test('a pupil returned twice draws one ticket, not two', async () => {
  // What a paging overlap looks like: a source walks a live collection and a
  // member enrolled between page one and page two arrives on both. Before
  // this, that child appeared twice in the candidate list — two tickets out
  // of three where everyone else held one, a rigged draw produced by nothing
  // worse than a well-timed enrolment.
  const roster = await sealRoster(klass, [
    { id: 'anna', role: 'student' },
    { id: 'boris', role: 'student' },
    { id: 'anna', role: 'student' },
  ])

  assert.equal(roster.members.length, 2)
  assert.equal(roster.class.students, 2)
  assert.equal(new Set(roster.members.map((member) => member.handle)).size, 2)
})

test('and the commitment is the one a clean read would have produced', async () => {
  // The join that matters: a receipt from a draw over the deduplicated roster
  // must verify against a roster read when the paging did not overlap.
  const overlapped = await sealRoster(klass, [
    { id: 'p1', role: 'student' },
    { id: 'p2', role: 'student' },
    { id: 'p1', role: 'student' },
    { id: 't1', role: 'teacher' },
  ])
  const clean = await sealRoster(klass, [
    { id: 'p1', role: 'student' },
    { id: 'p2', role: 'student' },
    { id: 't1', role: 'teacher' },
  ])

  assert.equal(overlapped.rosterHash, clean.rosterHash)
  assert.deepEqual(overlapped.members, clean.members)
})

test('a duplicate is settled by the handle, not by the id it arrived under', async () => {
  // A source that reports one person under two ids is a different fault and
  // is not this one: two ids are two handles and stay two members. What is
  // collapsed is one handle seen twice.
  const roster = await sealRoster(klass, [
    { id: 'anna', role: 'student' },
    { id: 'anna-2', role: 'student' },
  ])

  assert.equal(roster.members.length, 2)
})

test('one handle arriving as both pupil and teacher resolves the same either way', async () => {
  // A directory fault, and the resolution of one must not itself depend on
  // how the pages fell. The first draft took whichever copy came first, which
  // is page order wearing a justification about page order.
  const pupilFirst = await sealRoster(klass, [
    { id: 'x', role: 'student' },
    { id: 'x', role: 'teacher' },
  ])
  const teacherFirst = await sealRoster(klass, [
    { id: 'x', role: 'teacher' },
    { id: 'x', role: 'student' },
  ])

  assert.deepEqual(pupilFirst.members, teacherFirst.members)
  assert.equal(pupilFirst.rosterHash, teacherFirst.rosterHash)

  // And settled toward staff: a teacher counted as a pupil can win a pupil's
  // place, which is the failure that cannot be allowed to depend on paging.
  assert.equal(pupilFirst.members[0]!.role, 'teacher')
  assert.equal(pupilFirst.class.students, 0)
})

// THE REFLECTION. Every other seal here is answered by something: a receipt
// by verifyResult, a chain link by verifyChain, a sealed root by
// verifyInclusion, a programme's address by verifyProgramme. The roster
// commitment — which a draw receipt binds itself to — could be produced and
// never opened, which makes it an assertion wearing a hash.

test('a class list opens the commitment made over it', async () => {
  const raw = [...Array(6)].map((_, i) => ({ id: `pupil-${i}`, role: 'student' as const }))
  const sealed = await sealRoster(klass, raw)

  const opened = await verifyRoster(sealed.rosterHash, klass, raw)
  assert.equal(opened.valid, true)
  assert.match(opened.reason, /6 pupil\(s\)/)
})

test('one pupil swapped is a different class, and says so', async () => {
  // The sentence this makes checkable: "the draw ran over 12a and no other".
  const raw = [...Array(6)].map((_, i) => ({ id: `pupil-${i}`, role: 'student' as const }))
  const sealed = await sealRoster(klass, raw)

  for (const changed of [
    raw.map((m, i) => (i === 3 ? { ...m, id: 'someone-else' } : m)),
    [...raw, { id: 'pupil-6', role: 'student' as const }],
    raw.slice(0, 5),
  ]) {
    const opened = await verifyRoster(sealed.rosterHash, klass, changed)
    assert.equal(opened.valid, false)
    assert.match(opened.reason, /a different class, or the same class at a different moment/)
  }
})

test('the same pupils in another class do not open it', async () => {
  // Handles are class-scoped, so the commitment is too: a roster cannot be
  // lifted from one class and presented as another's.
  const raw = [...Array(4)].map((_, i) => ({ id: `pupil-${i}`, role: 'student' as const }))
  const sealed = await sealRoster(klass, raw)

  const elsewhere = await verifyRoster(sealed.rosterHash, { id: '11b', name: '11b' }, raw)
  assert.equal(elsewhere.valid, false)
})

test('the caller the tool answered can check it holding no identity at all', async () => {
  // rosterHashOfHandles closes the loop for whoever received the tool's
  // output: handles in, commitment out, and nobody named anywhere.
  const raw = [
    { id: 'p1', role: 'student' as const },
    { id: 'p2', role: 'student' as const },
    { id: 't1', role: 'teacher' as const },
  ]
  const sealed = await sealRoster(klass, raw)
  const handles = sealed.members.filter((m) => m.role === 'student').map((m) => m.handle)

  assert.equal(await rosterHashOfHandles(handles), sealed.rosterHash)
})

test('and a draw receipt is answered by the same commitment', async () => {
  // The join the whole design rests on, now checkable from either end.
  const raw = [...Array(5)].map((_, i) => ({ id: `pupil-${i}`, role: 'student' as const }))
  const sealed = await sealRoster(klass, raw)
  const drawn = await pickWeighted('seed', 'round-1', sealed.members
    .filter((m) => m.role === 'student')
    .map((m) => ({ value: m.handle, weight: 1 })))

  assert.equal(drawn.receipt.rosterHash, sealed.rosterHash)
  assert.equal((await verifyRoster(drawn.receipt.rosterHash!, klass, raw)).valid, true)
})
