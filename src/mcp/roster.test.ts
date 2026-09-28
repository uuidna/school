import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { rosterMcpTools } from './roster.js'

// THE PROMISE THE TOOL MAKES IS THAT IT CANNOT NAME A CHILD. The store behind
// this harness holds names, addresses and parents, exactly as a real one does,
// so what these assert about the output is asserted against data that could
// have leaked rather than against a fixture trimmed to make the point.

const USERS = [
  { class: '12a', email: 'anna.petrova@students.school.bg', id: 1, name: 'Anna Petrova', role: 'student' },
  { class: '12a', email: 'boris.ivanov@students.school.bg', id: 2, name: 'Boris Ivanov', role: 'student' },
  { class: '12a', email: 'mariya@school.bg', id: 3, name: 'Mariya Dimitrova', role: 'teacher' },
  { class: '12a', email: 'parent.of.anna@parents.school.bg', id: 4, name: 'Ivan Petrov', role: 'parent' },
  { class: '11b', email: 'petar@students.school.bg', id: 5, name: 'Petar Georgiev', role: 'student' },
]

const req = () =>
  ({
    headers: new Headers({ host: 'school.bg' }),
    payload: {
      count: async () => ({ totalDocs: 1 }),
      find: async (args: { collection: string }) =>
        args.collection === 'tenants'
          ? { docs: [{ domain: 'school.bg', id: 1 }], hasNextPage: false, totalDocs: 1 }
          : { docs: args.collection === 'users' ? USERS : [], hasNextPage: false, totalDocs: USERS.length },
    },
  }) as unknown as PayloadRequest

const tool = (name: string) => rosterMcpTools.find((entry) => entry.name === name)!

const run = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await tool(name).handler(args, req())
  return { isError: result.isError === true, text: result.content[0]!.text }
}

test('the class listing answers how big, never who', async () => {
  const { text } = await run('school_classes')
  const body = JSON.parse(text) as { classes: { id: string; students: number }[]; pupils: number }

  assert.deepEqual(body.classes.map((klass) => klass.id), ['11b', '12a'])
  assert.equal(body.pupils, 3)
  for (const leak of ['Anna', 'anna.petrova', 'Mariya', 'parent.of.anna']) {
    assert.ok(!text.includes(leak), `the class listing carried ${leak}`)
  }
})

test('the roster is handles and a commitment, and nothing that names anybody', async () => {
  const { text } = await run('school_class_roster', { class: '12a' })
  const body = JSON.parse(text) as { members: { handle: string; role: string }[]; rosterHash: string }

  assert.equal(body.members.length, 3)
  assert.equal(body.members.filter((member) => member.role === 'student').length, 2)
  assert.match(body.rosterHash, /^[0-9a-f]{64}$/)

  for (const leak of ['Anna Petrova', 'anna.petrova', 'Mariya', 'Ivan Petrov', '@students.']) {
    assert.ok(!text.includes(leak), `the roster carried ${leak}`)
  }
  // And nothing shaped like a field that could carry one later.
  assert.deepEqual(
    [...new Set(body.members.flatMap((member) => Object.keys(member)))].sort(),
    ['handle', 'role'],
  )
})

test('an unknown class refuses rather than reporting a class with nobody in it', async () => {
  // A draw over nobody is the one that must never quietly proceed, and an
  // empty roster and a mistyped id look identical downstream.
  const missing = await run('school_class_roster', { class: '13z' })
  assert.ok(missing.isError)
  assert.match(missing.text, /school_classes/)

  const blank = await run('school_class_roster', { class: '   ' })
  assert.ok(blank.isError)
})

test('no roster tool writes, and none is offered to a parent or a pupil', async () => {
  // A parent asking for their child's class would be asking for the other
  // children in it. The verification page answers what a parent is entitled
  // to — a draw, checkable — without the roster.
  for (const entry of rosterMcpTools) {
    assert.equal(entry.writes, false)
    assert.deepEqual(entry.needs, ['rosters'])
    assert.ok(!entry.allowedRoles.includes('parent'), `${entry.name} is offered to parents`)
    assert.ok(!entry.allowedRoles.includes('student'), `${entry.name} is offered to pupils`)
  }
})

test('there is no argument that turns the names back on', async () => {
  // A flag that relaxes a protection is the protection's absence with a
  // longer name. The schema is the enforcement: nothing accepts one.
  const declared = rosterMcpTools.flatMap((entry) =>
    Object.keys(entry.inputSchema.properties ?? {}),
  )

  assert.deepEqual(declared, ['class'])
})
