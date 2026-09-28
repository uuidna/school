import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { rbacMcpTools } from './rbac.js'

// THE FOUR TOOLS THAT DECIDE WHO MAY SEE A PUPIL'S RECORD HAD NO TEST FILE.
//
// src/plugins/rbac/index.test.ts covers the COLLECTION and the hook — the
// append-only rule, the log the hook writes. The tools were covered only where
// server.test.ts exercises the role gate on school_grant_role. Everything the
// README promises about them — a reason of at least eight characters because
// art. 5(2) asks why and not merely whether, parent unrevokable because being
// a parent follows from an address, the account kept because art. 30 requires
// the trail — was asserted in prose and checked nowhere.
//
// Found by counting: of twenty-five tools, ten are named by no test.

const USERS: Record<string, unknown>[] = [
  { class: null, email: 'head@school.bg', id: 1, role: 'admin' },
  { class: null, email: 'reg@school.bg', id: 2, role: 'registrar' },
  { class: null, email: 'teach@school.bg', id: 3, role: 'teacher' },
  { class: '12a@students.school.bg', email: '12a@students.school.bg', id: 4, role: 'student' },
  { class: '12a@students.school.bg', email: '12a@parents.school.bg', id: 5, role: 'parent' },
]

const harness = () => {
  const updates: { data: Record<string, unknown>; reason?: unknown }[] = []

  const payload = {
    count: async () => ({ totalDocs: 1 }),
    // THE ACCESS TRAIL IS VERSION HISTORY NOW, so the door asks for versions
    // rather than for rows of a log collection that no longer exists.
    findVersions: async () => ({ docs: [], hasNextPage: false, totalDocs: 0 }),
    find: async (args: { collection: string; where?: Record<string, { equals?: string }> }) => {
      if (args.collection === 'tenants') {
        return { docs: [{ domain: 'school.bg', id: 1 }], hasNextPage: false, totalDocs: 1 }
      }
      const wanted = args.where?.email?.equals
      const docs = wanted ? USERS.filter((u) => u.email === wanted) : USERS
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
    update: async (args: { context?: { accessReason?: unknown }; data: Record<string, unknown> }) => {
      updates.push({ data: args.data, reason: args.context?.accessReason })
      return { id: 1 }
    },
  }

  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  return { req, updates }
}

const tool = (name: string) => rbacMcpTools.find((entry) => entry.name === name)!
const run = async (name: string, args: Record<string, unknown>, req: PayloadRequest) => {
  const result = await tool(name).handler(args, req)
  return { isError: result.isError === true, text: result.content[0]!.text }
}

test('a role change without a stated reason is refused before anything is read', async () => {
  // art. 5(2) asks the controller to demonstrate WHY a right was given, not
  // merely that it was. A blank reason and a seven-character one are the same
  // failure and both are refused.
  const { req, updates } = harness()

  for (const reason of ['', '   ', 'because', 'ok then']) {
    const out = await run('school_grant_role', { email: 'teach@school.bg', reason, role: 'registrar' }, req)
    assert.equal(out.isError, true, `"${reason}" was accepted as a reason`)
    assert.match(out.text, /at least 8 characters/)
  }

  assert.deepEqual(updates, [], 'a refused grant still changed a role')
})

test('the reason travels with the change, not beside it', async () => {
  // It reaches the append-only log through the update's own context, so a
  // change made through the panel, the REST API, MCP or a script records the
  // same thing. A reason the tool kept to itself would demonstrate nothing.
  const { req, updates } = harness()

  await run(
    'school_grant_role',
    { email: 'teach@school.bg', reason: 'appointed deputy registrar from 1 October', role: 'registrar' },
    req,
  )

  assert.equal(updates.length, 1)
  assert.equal(updates[0]!.data.role, 'registrar')
  assert.equal(updates[0]!.reason, 'appointed deputy registrar from 1 October')
})

test('granting a role someone already holds changes nothing and says so', async () => {
  const { req, updates } = harness()

  const out = await run(
    'school_grant_role',
    { email: 'reg@school.bg', reason: 'confirming the existing appointment', role: 'registrar' },
    req,
  )

  assert.match(out.text, /already holds the role registrar/)
  assert.deepEqual(updates, [], 'a no-op grant wrote to the log')
})

test('a parent cannot be revoked, because there is nothing to revoke', async () => {
  // Dropping a parent to `student` would not remove a permission — it would
  // reclassify them and sever the class link their access depends on. The
  // README says parent is derived from an address and never granted; this is
  // the same fact from the other end.
  const { req, updates } = harness()

  for (const email of ['12a@parents.school.bg', '12a@students.school.bg']) {
    const out = await run('school_revoke_access', { email, reason: 'end of the school year' }, req)
    assert.match(out.text, /holds no staff permissions/)
  }

  assert.deepEqual(updates, [], 'revoking a parent or pupil changed their role')
})

test('revoking staff drops them to student and keeps the account', async () => {
  // Deletion would destroy the record art. 30 requires be retained, so the
  // account and its trail stay and only the permissions go.
  const { req, updates } = harness()

  const out = await run(
    'school_revoke_access',
    { email: 'reg@school.bg', reason: 'left the school on 30 September' },
    req,
  )

  assert.equal(updates.length, 1)
  assert.equal(updates[0]!.data.role, 'student')
  assert.match(out.text, /The account and its audit trail are kept/)
  assert.match(JSON.parse(out.text).revokedFrom, /registrar/)
})

test('revoking also demands a reason', async () => {
  const { req, updates } = harness()
  const out = await run('school_revoke_access', { email: 'reg@school.bg', reason: 'left' }, req)

  assert.equal(out.isError, true)
  assert.deepEqual(updates, [])
})

test('an account that does not exist is answered, not invented', async () => {
  const { req, updates } = harness()

  for (const name of ['school_grant_role', 'school_revoke_access', 'school_check_access']) {
    const out = await run(name, { email: 'nobody@school.bg', reason: 'a stated reason here', role: 'teacher' }, req)
    assert.match(out.text, /No account for nobody@school\.bg/)
  }
  assert.deepEqual(updates, [])
})

test('the access review reports every role and reaches no pupil record', async () => {
  const { req } = harness()
  const out = await run('school_access_review', {}, req)
  const body = JSON.parse(out.text) as {
    note: string
    roles: Record<string, { count: number; users: { email: string }[] }>
    total: number
  }

  assert.equal(body.total, USERS.length)
  assert.deepEqual(Object.keys(body.roles).sort(), ['admin', 'parent', 'registrar', 'student', 'teacher'])
  assert.match(body.note, /No pupil records are included/)

  // What it carries is accounts, not records: an address, a name where there
  // is one, and the class an addressing already states.
  const fields = new Set(Object.values(body.roles).flatMap((r) => r.users.flatMap((u) => Object.keys(u))))
  assert.deepEqual([...fields].sort(), ['class', 'email'])
})

test('what one person can do is read from the access rules, not restated', async () => {
  // A literal repeated in the tool would go on answering the old question
  // after the rules changed.
  const { req } = harness()

  const staff = JSON.parse((await run('school_check_access', { email: 'teach@school.bg' }, req)).text)
  const pupil = JSON.parse((await run('school_check_access', { email: '12a@students.school.bg' }, req)).text)

  assert.equal(staff.canReachAdminPanel, true)
  assert.equal(staff.canSeePupilRecords, true)
  assert.equal(pupil.canReachAdminPanel, false)
  assert.equal(pupil.canSeePupilRecords, false)
})

test('no tool here creates an account or deletes one', async () => {
  // Creating an identity and erasing a person are acts for a named human, and
  // deletion would destroy the trail art. 30 requires be kept.
  for (const entry of rbacMcpTools) {
    assert.ok(!/create|delete|remove/.test(entry.name), `${entry.name} names a create or delete`)
  }
  assert.deepEqual(
    rbacMcpTools.filter((e) => e.writes).map((e) => e.name).sort(),
    ['school_grant_role', 'school_revoke_access'],
  )
})
