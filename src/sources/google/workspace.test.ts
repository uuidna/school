import assert from 'node:assert/strict'
import { test } from 'node:test'

import { UnsupportedCapability } from '../types.js'
import { handleFor } from '../roster.js'
import { SCOPES, scopesFor } from './api.js'
import { domainsFor } from './identity.js'
import { googleWorkspaceSource } from './workspace.js'

// EVERY CALL THIS PACKAGE MAKES TO A SCHOOL'S GOOGLE IS ASSERTED HERE. No
// network and no credential: a fake transport records the exact URL, and these
// tests fail if a listing silently stops at the first page, if an absent
// capability answers empty instead of refusing, or if a read-only deployment
// can be made to write.

const D = domainsFor('school.bg')

type Route = (url: string) => unknown

const harness = (routes: Record<string, Route>, over = {}) => {
  const calls: { method: string; url: string }[] = []

  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url })
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    if (!key) return new Response('not found', { status: 404 })
    return Response.json(routes[key]!(url))
  }

  const source = googleWorkspaceSource({
    documentsFolderId: 'folder-1',
    domains: D,
    fetch: fetch as never,
    roles: { groups: { 'registrars@school.bg': 'registrar' }, orgUnits: { '/Staff/Teachers': 'teacher' } },
    token: () => 'test-token',
    ...over,
  })

  return { calls, source }
}

const user = (email: string, over = {}) => ({
  id: email,
  name: { fullName: email },
  orgUnitPath: '/Staff/Teachers',
  primaryEmail: email,
  ...over,
})

test('people are read from Directory, on this school’s domain', async () => {
  const { calls, source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({ groups: [] }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('dir@school.bg')],
    }),
  })

  const people = await source.listPeople()

  assert.equal(people[0]!.email, 'dir@school.bg')
  assert.ok(calls.some((c) => c.url.includes('domain=school.bg')), 'the domain was not scoped')
})

test('a listing pages to the end rather than stopping at the first page', async () => {
  // A review that stops at 500 accounts answers "who can see pupils' data"
  // with a guess.
  let page = 0
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({ groups: [] }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => {
      page++
      return page < 3
        ? { nextPageToken: `p${page}`, users: [user(`u${page}@school.bg`)] }
        : { users: [user('u3@school.bg')] }
    },
  })

  assert.equal((await source.listPeople()).length, 3)
})

test('a pupil is a pupil by domain, whatever groups say', async () => {
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({
      groups: [{ email: 'registrars@school.bg' }],
    }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('12a@students.school.bg', { orgUnitPath: '/Students' })],
    }),
  })

  assert.equal((await source.listPeople())[0]!.role, 'student')
})

test('group membership decides a staff role the address cannot', async () => {
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({
      groups: [{ email: 'registrars@school.bg' }],
    }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('someone@school.bg')],
    }),
  })

  assert.equal((await source.listPeople())[0]!.role, 'registrar')
})

test('documents come from the named Drive folder and carry their link', async () => {
  const { calls, source } = harness({
    'https://www.googleapis.com/drive/v3/files': () => ({
      files: [{ id: 'f1', name: 'Правилник за дейността', webViewLink: 'https://drive/f1' }],
    }),
  })

  const [document] = await source.listDocuments()

  assert.equal(document!.reachable, true)
  assert.equal(document!.url, 'https://drive/f1')
  // Assert the query the folder actually receives, not one encoding of it.
  const query = new URL(calls[0]!.url).searchParams.get('q') ?? ''
  assert.match(query, /'folder-1' in parents/)
  assert.match(query, /trashed = false/, 'deleted files were not excluded')
})

test('a Drive file with no link is not reachable', async () => {
  const { source } = harness({
    'https://www.googleapis.com/drive/v3/files': () => ({ files: [{ id: 'f1', name: 'Устав' }] }),
  })

  assert.equal((await source.listDocuments())[0]!.reachable, false)
})

test('Workspace declares it has no selection trail, and refuses rather than answering empty', async () => {
  // Answering [] would make school_fairness_audit report an intact chain of
  // zero receipts — a false clean bill of health.
  const { source } = harness({})

  assert.equal(source.capabilities.selections, false)
  await assert.rejects(() => source.listSelections(), UnsupportedCapability)
  await assert.rejects(() => source.listCheckpoints(), UnsupportedCapability)
})

test('an audit entry states no reason rather than inventing one', async () => {
  // Workspace records that a change happened and by whom. It has no field for
  // why, which is what art. 5(2) asks for.
  const { source } = harness({
    'https://admin.googleapis.com/admin/reports/v1/activity': () => ({
      items: [
        {
          actor: { email: 'dir@school.bg' },
          events: [{ name: 'GRANT_ADMIN_PRIVILEGE', parameters: [{ name: 'USER_EMAIL', value: 'x@school.bg' }] }],
          id: { time: '2026-09-01T00:00:00Z' },
        },
      ],
    }),
  })

  const [change] = await source.listAccessChanges()

  assert.equal(change!.reason, null)
  assert.equal(change!.subject, 'x@school.bg')
})

test('a read-only deployment cannot be made to write', async () => {
  const { source } = harness({})

  assert.equal(source.capabilities.peopleWritable, false)
  await assert.rejects(() => source.setRole('x@school.bg', 'teacher', 'a good reason'), UnsupportedCapability)
})

test('a role change still demands a reason, even where Directory has no field for it', async () => {
  const { source } = harness({}, { writablePeople: true })

  await assert.rejects(() => source.setRole('x@school.bg', 'teacher', 'short'), /at least 8 characters/)
})

test('a role with no mapped org unit is refused rather than guessed at', async () => {
  const { source } = harness({}, { writablePeople: true })

  await assert.rejects(
    () => source.setRole('x@school.bg', 'admin', 'promoting the deputy head'),
    /No org unit is mapped/,
  )
})

test('a writable deployment changes the org unit, with the token attached', async () => {
  const { calls, source } = harness(
    { 'https://admin.googleapis.com/admin/directory/v1/users': () => user('x@school.bg') },
    { writablePeople: true },
  )

  await source.setRole('x@school.bg', 'teacher', 'appointed to teach 12a')

  const write = calls.find((call) => call.method === 'PUT')
  assert.ok(write, 'no write was issued')
})

test('a person who is not in the directory is absent, not an error', async () => {
  const { source } = harness({})

  assert.equal(await source.findPersonByEmail('nobody@school.bg'), undefined)
})

test('documents are declared unavailable when no folder was configured', async () => {
  const { source } = harness({}, { documentsFolderId: undefined })

  assert.equal(source.capabilities.documents, false)
  await assert.rejects(() => source.listDocuments(), UnsupportedCapability)
})

test('a parent address is the parent role, carrying its class', async () => {
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({ groups: [] }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('12a@parents.school.bg', { orgUnitPath: '/Parents' })],
    }),
  })

  const [person] = await source.listPeople()

  assert.equal(person!.role, 'parent')
  assert.equal(person!.class, '12a@students.school.bg')
})

test('a parent cannot be promoted into staff by a group', async () => {
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({
      groups: [{ email: 'registrars@school.bg' }],
    }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('12a@parents.school.bg', { orgUnitPath: '/Parents' })],
    }),
  })

  assert.equal((await source.listPeople())[0]!.role, 'parent')
})

test('a pupil and their parents resolve to the same class', async () => {
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({ groups: [] }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('12a@students.school.bg'), user('12a@parents.school.bg')],
    }),
  })

  const people = await source.listPeople()
  assert.equal(people[0]!.class, people[1]!.class)
})

test('staff carry no class, so nothing confines them to one', async () => {
  const { source } = harness({
    'https://admin.googleapis.com/admin/directory/v1/groups': () => ({ groups: [] }),
    'https://admin.googleapis.com/admin/directory/v1/users': () => ({
      users: [user('dir@school.bg')],
    }),
  })

  assert.equal((await source.listPeople())[0]!.class, undefined)
})

// CLASSROOM. The fixtures below carry exactly what Classroom returns when a
// school has granted the profile scopes — names and addresses — so that the
// assertions about what does NOT come out are assertions about live-shaped
// data rather than about a payload trimmed to make the point.

const PROFILE = {
  emailAddress: 'anna.petrova@students.school.bg',
  id: 'g-anna',
  name: { fullName: 'Anna Petrova' },
}

const classroom = (over = {}) =>
  harness(
    {
      'https://classroom.googleapis.com/v1/courses/c-1/students': (url) =>
        url.includes('pageToken=p2')
          ? { students: [{ profile: PROFILE, userId: 'g-boris' }] }
          : {
              nextPageToken: 'p2',
              students: [{ profile: PROFILE, userId: 'g-anna' }],
            },
      'https://classroom.googleapis.com/v1/courses/c-1/teachers': () => ({
        teachers: [{ profile: PROFILE, userId: 'g-teacher' }],
      }),
      'https://classroom.googleapis.com/v1/courses/c-1': () => ({
        courseGroupEmail: '12a@school.bg',
        courseState: 'ACTIVE',
        id: 'c-1',
        name: 'Year 12',
        section: '12a',
      }),
      'https://classroom.googleapis.com/v1/courses': () => ({
        courses: [
          { courseState: 'ACTIVE', id: 'c-1', name: 'Year 12', section: '12a' },
          { courseState: 'ACTIVE', id: 'c-2', name: 'Year 11', section: '11b' },
        ],
      }),
    },
    { classroom: true, ...over },
  )

test('a school without Classroom is not offered rosters, and refuses rather than answering empty', async () => {
  const { source } = harness({})

  assert.equal(source.capabilities.rosters, false)
  await assert.rejects(() => source.listClasses(), UnsupportedCapability)
  await assert.rejects(() => source.listRoster('c-1'), UnsupportedCapability)
})

test('courses are read active-only', async () => {
  const { calls, source } = classroom()
  const classes = await source.listClasses()

  assert.equal(classes.length, 2)
  // An archived course is not this year's class: drawing over last year's 12a
  // selects a pupil who has left.
  assert.ok(
    calls.some((call) => call.url.includes('courseStates=ACTIVE')),
    'every course state was requested',
  )
  assert.equal(classes[0]!.name, 'Year 12 · 12a')
})

test('a roster is paged to the end', async () => {
  // A pupil on page two is a pupil who cannot win.
  const { source } = classroom()
  const roster = await source.listRoster('c-1')

  assert.equal(roster.class.students, 2)
  assert.equal(roster.class.teachers, 1)
})

test('no name and no address reaches the caller, even when Classroom sends them', async () => {
  const { source } = classroom()
  const roster = await source.listRoster('c-1')
  const rendered = JSON.stringify(roster)

  for (const leak of ['anna.petrova', 'Anna Petrova', 'students.school.bg', 'g-anna']) {
    assert.ok(!rendered.includes(leak), `the roster carried ${leak}`)
  }
  assert.ok(roster.members.every((member) => /^[0-9a-f]{32}$/.test(member.handle)))
})

test('the class name and group survive, because they are not a child', async () => {
  const { source } = classroom()
  const roster = await source.listRoster('c-1')

  assert.equal(roster.class.name, 'Year 12 · 12a')
  assert.equal(roster.class.group, '12a@school.bg')
})

test('the roster scope is asked for without the two that would name the children', async () => {
  // Classroom will put emailAddress and photoUrl on every student row if the
  // consent screen asked for classroom.profile.emails or .photos. Neither is
  // requestable from here, so a school reading its consent screen sees the
  // minimisation before it grants anything rather than being told about it
  // afterwards.
  const scopes = scopesFor({ rosters: true })

  assert.ok(scopes.includes(SCOPES.rosters))
  assert.ok(scopes.includes(SCOPES.courses))
  assert.deepEqual(scopes.filter((scope) => scope.includes('classroom.profile')), [])
  assert.ok(scopes.every((scope) => !scope.includes('.rosters') || scope.endsWith('.readonly')))
})

test('a school that does not teach through Classroom is not asked for Classroom at all', async () => {
  assert.deepEqual(
    scopesFor({ documents: true }).filter((scope) => scope.includes('classroom')),
    [],
  )
})

test('the handle is keyed on the Directory id, never on the address', async () => {
  // Both are hashes and neither shows in the output, so only recomputing tells
  // them apart. An address is public and documented — <class>@students.<domain>
  // — so a handle keyed on one is a digest of a guessable string.
  const { source } = classroom()
  const roster = await source.listRoster('c-1')
  const handles = roster.members.map((member) => member.handle)

  assert.ok(handles.includes(await handleFor('c-1', 'g-anna')))
  assert.ok(!handles.includes(await handleFor('c-1', PROFILE.emailAddress)))
})
