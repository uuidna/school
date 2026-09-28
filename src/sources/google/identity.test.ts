import assert from 'node:assert/strict'
import { test } from 'node:test'

import { domainsFor, identify, maySeeClassDraw, verifiedFromIdToken } from './identity.js'

// AN ADDRESS IS A CLAIM. Everything a person may do here is derived from which
// Workspace domain vouched for them, so every test below is an attempt to say
// "I am staff" without Google having said it. If any of these start passing,
// role derivation has become an escalation path.

const D = domainsFor('school.bg')
const token = (email: string, extra: Record<string, unknown> = {}) =>
  verifiedFromIdToken({ email, email_verified: true, ...extra }, D)

test('the three domains derive from the primary one', () => {
  assert.deepEqual(D, {
    base: 'school.bg',
    parents: 'parents.school.bg',
    students: 'students.school.bg',
  })
})

test('staff, pupils and parents are told apart by the audience subdomain', () => {
  assert.equal(identify(token('12a@school.bg')!, D)!.kind, 'staff')
  assert.equal(identify(token('12a@students.school.bg')!, D)!.kind, 'student')
  assert.equal(identify(token('12a@parents.school.bg')!, D)!.kind, 'parent')
})

test('a class is addressed, never an individual pupil', () => {
  // The unit is the class, so no address here names a child.
  const parent = identify(token('12a@parents.school.bg')!, D)!
  const pupil = identify(token('12a@students.school.bg')!, D)!

  assert.equal(parent.classId, '12a')
  assert.equal(parent.kind === 'parent' && parent.classEmail, '12a@students.school.bg')
  assert.equal(pupil.kind === 'student' && pupil.classEmail, '12a@students.school.bg')
})

test("a class's parents may see that class's draw, and no other", () => {
  const parent = identify(token('12a@parents.school.bg')!, D)!

  assert.equal(maySeeClassDraw(parent, '12a@students.school.bg'), true)
  assert.equal(maySeeClassDraw(parent, '12b@students.school.bg'), false)
})

test('staff do not reach a draw through the class addressing', () => {
  // Staff authority comes from their role; letting the address confer it too
  // would be a second, unaudited path to the same records.
  const staff = identify(token('12a@school.bg')!, D)!
  assert.equal(maySeeClassDraw(staff, '12a@students.school.bg'), false)
})

test('an unverified email is refused', () => {
  assert.equal(verifiedFromIdToken({ email: 'dir@school.bg', email_verified: false }, D), null)
  assert.equal(verifiedFromIdToken({ email: 'dir@school.bg' }, D), null)
})

test('a lookalike domain is not the school', () => {
  // The staff domain is a suffix of the pupil and parent domains, so a
  // suffix test would accept every one of these.
  for (const email of [
    '12a@school.bg.evil.com',
    '12a@students.school.bg.evil.com',
    '12a@notschool.bg',
    '12a@sub.school.bg',
    '12a@evil.com',
  ]) {
    assert.equal(token(email), null, `${email} was accepted as school.bg`)
  }
})

test('a hosted-domain claim for another school is refused', () => {
  assert.equal(token('12a@school.bg', { hd: 'other-school.bg' }), null)
  assert.ok(token('12a@school.bg', { hd: 'school.bg' }))
})

test('an address with no local part is refused', () => {
  assert.equal(token('@school.bg'), null)
})

test('case and padding do not create a second identity', () => {
  const upper = token('  12A@Students.School.BG  ')
  assert.ok(upper)
  assert.equal(identify(upper, D)!.email, '12a@students.school.bg')
})

test('a class address cannot be passed off as staff by dotting the domain', () => {
  assert.equal(token('12a@students.school.bg.'), null)
  assert.equal(token('12a@.school.bg'), null)
})
