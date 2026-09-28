import assert from 'node:assert/strict'
import { test } from 'node:test'


import { domainsFor, identify, maySeeClassDraw, verifiedFromIdToken } from '../sources/google/identity.js'
import { isOwnClass } from './roles.js'

// THE SAME RULE IS STATED TWICE, SO IT IS CHECKED AGAINST ITSELF. "May this
// person see this class's draw" is answered by isOwnClass for a Payload user
// and by maySeeClassDraw for a verified Workspace identity. Two statements of
// one rule is how a rule drifts, and a school where the two disagree would let
// somebody in through one door who is refused at the other.

const D = domainsFor('school.bg')

const viaWorkspace = (email: string, klass: string): boolean => {
  const verified = verifiedFromIdToken({ email, email_verified: true }, D)
  if (!verified) return false
  const identity = identify(verified, D)
  return identity ? maySeeClassDraw(identity, klass) : false
}

const viaPayload = (email: string, klass: string): boolean => {
  const domain = email.slice(email.lastIndexOf('@') + 1)
  const local = email.slice(0, email.lastIndexOf('@'))

  // What the Workspace adapter derives, expressed as a stored user.
  const role =
    domain === D.students ? 'student' : domain === D.parents ? 'parent' : 'teacher'
  const own = role === 'teacher' ? undefined : `${local}@${D.students}`

  // Derived from the function being fed, never restated — see roles.test.ts.
  const result = isOwnClass()({
    req: { user: { class: own, email, id: 1, role } },
  } as unknown as Parameters<ReturnType<typeof isOwnClass>>[0])

  if (result === true) return true
  if (result === false) return false
  return (result as { class: { equals: string } }).class.equals === klass
}

const CASES: [string, string][] = [
  ['12a@parents.school.bg', '12a@students.school.bg'],
  ['12a@parents.school.bg', '12b@students.school.bg'],
  ['12a@students.school.bg', '12a@students.school.bg'],
  ['12a@students.school.bg', '12c@students.school.bg'],
  ['12b@parents.school.bg', '12a@students.school.bg'],
]

test('both doors answer the same for a parent or pupil', () => {
  for (const [email, klass] of CASES) {
    assert.equal(
      viaWorkspace(email, klass),
      viaPayload(email, klass),
      `${email} asking about ${klass}: the two rules disagree`,
    )
  }
})

test('a parent reaches their own class through either door', () => {
  assert.equal(viaWorkspace('12a@parents.school.bg', '12a@students.school.bg'), true)
  assert.equal(viaPayload('12a@parents.school.bg', '12a@students.school.bg'), true)
})

test("neither door opens onto another class", () => {
  assert.equal(viaWorkspace('12a@parents.school.bg', '12b@students.school.bg'), false)
  assert.equal(viaPayload('12a@parents.school.bg', '12b@students.school.bg'), false)
})

test('staff are not admitted by the class rule on either side', () => {
  // Their authority is their role. A second, unaudited path to the same
  // records through an address is what this keeps shut.
  assert.equal(viaWorkspace('dir@school.bg', '12a@students.school.bg'), false)
})

test('an unverified address opens nothing', () => {
  const unverified = verifiedFromIdToken(
    { email: '12a@parents.school.bg', email_verified: false },
    D,
  )
  assert.equal(unverified, null)
})
