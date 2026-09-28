import assert from 'node:assert/strict'
import { test } from 'node:test'


import {
  canUseAdminPanel,
  classOf,
  GRANTABLE_ROLES,
  isOwnClass,
  isParent,
  isSelfOrAdmin,
  roleOf,
  STAFF_ROLES,
} from './roles.js'

// A PARENT'S ENTIRE AUTHORITY IS ONE CLASS LINK. Most of these tests are about
// what a parent must NOT reach, because the dangerous failure is not "a parent
// cannot see their child's draw" — it is a parent seeing every other child's.

/**
 * A signed-in user, shaped as the access layer receives one.
 *
 * THE TARGET TYPE IS DERIVED, NOT RESTATED. This used to be annotated
 * `{ req: PayloadRequest }` — the argument's shape spelled out here, in a test,
 * beside the library that owns it. When Payload 4 added `slug` to `AccessArgs`
 * the annotation went stale and fifteen call sites failed with one message
 * fifteen times, which is what a hand-copied type always costs: a change the
 * library made once is paid for once per use. Taking the parameter type of the
 * function under test folds the fifteen back to zero — there is nothing left
 * here that can disagree with Payload, because nothing here says what Payload's
 * shape is.
 */
type AccessArg = Parameters<typeof isParent>[0]

const as = (role?: string, klass?: string) =>
  ({ req: { user: role ? { class: klass, email: 'x@school.bg', id: 1, role } : null } }) as unknown as AccessArg

test('a parent is a role the layer knows', () => {
  assert.equal(roleOf(as('parent').req.user), 'parent')
  assert.equal(isParent(as('parent', '12a@students.school.bg')), true)
  assert.equal(isParent(as('teacher')), false)
})

test('a parent does not reach the admin panel', () => {
  assert.equal(canUseAdminPanel(as('parent', '12a@students.school.bg')), false)
})

test('a parent is not staff, so nothing gated on staff admits them', () => {
  assert.equal(STAFF_ROLES.includes('parent'), false)
})

test('a parent sees their own class and no other', () => {
  const gate = isOwnClass()
  const result = gate(as('parent', '12a@students.school.bg'))

  assert.deepEqual(result, { class: { equals: '12a@students.school.bg' } })
})

test('a parent with no class reaches nothing, rather than everything', () => {
  // The hole this closes: { class: { equals: undefined } } is not a
  // restriction — returning it would hand a parent every class in the school.
  const gate = isOwnClass()

  assert.equal(gate(as('parent')), false)
  assert.equal(gate(as('parent', '')), false)
  assert.equal(gate(as('parent', '   ')), false)
})

test('a pupil is confined the same way', () => {
  assert.deepEqual(isOwnClass()(as('student', '12a@students.school.bg')), {
    class: { equals: '12a@students.school.bg' },
  })
})

test('staff see the school rather than one class', () => {
  for (const role of STAFF_ROLES) {
    assert.equal(isOwnClass()(as(role)), true, `${role} was confined to a class`)
  }
})

test('an unauthenticated caller is refused, not confined', () => {
  assert.equal(isOwnClass()(as()), false)
})

test('an identity with no role reaches nothing', () => {
  // An MCP key has no role and must pass no role gate.
  const key = { req: { user: { id: 'key' } } } as unknown as AccessArg
  assert.equal(isOwnClass()(key), false)
})

test('a role this build does not recognise reaches nothing', () => {
  // roleOf reads whatever the database holds, so a legacy or mistyped role is
  // a real value that arrives here. It must not fall through to a class filter
  // — and with no class it would be a filter on undefined, which is no filter.
  assert.equal(isOwnClass()(as('guardian', '12a@students.school.bg')), false)
  assert.equal(isOwnClass()(as('governor')), false)
})

test('the class column can be named differently per collection', () => {
  assert.deepEqual(isOwnClass('classGroup')(as('parent', '12a@students.school.bg')), {
    classGroup: { equals: '12a@students.school.bg' },
  })
})

test('a class is matched case-insensitively and without padding', () => {
  assert.equal(classOf({ class: '  12A@Students.School.BG ' } as never), '12a@students.school.bg')
  assert.equal(classOf({ class: 42 } as never), undefined)
  assert.equal(classOf(null as never), undefined)
})

test('parent is not a role anybody can grant', () => {
  // Being a parent follows from <class>@parents.<domain>. A granted parent
  // would be the parent of no class.
  assert.equal(GRANTABLE_ROLES.includes('parent'), false)
  for (const role of ['admin', 'registrar', 'student', 'teacher'] as const) {
    assert.ok(GRANTABLE_ROLES.includes(role), `${role} should be grantable`)
  }
})

test('a parent may still read their own account record', () => {
  const result = isSelfOrAdmin(as('parent', '12a@students.school.bg'))

  assert.deepEqual(result, { id: { equals: 1 } })
})
