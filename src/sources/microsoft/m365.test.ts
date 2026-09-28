import assert from 'node:assert/strict'
import { test } from 'node:test'

import { UnsupportedCapability } from '../types.js'
import { GRAPH_PERMISSIONS, permissionsFor } from './api.js'
import { handleFor } from '../roster.js'
import { microsoft365Source } from './m365.js'

// GRAPH PAGES BY FOLLOWING A LINK, NOT BY CARRYING A TOKEN. Microsoft's own
// documentation says not to extract the $skiptoken and reuse it, because the
// link encodes the rest of the original query. Treating it like Google's
// pageToken returns page one forever — a directory that looks complete and is
// one page long. That is the failure these tests exist for.

const DOMAINS = { base: 'school.bg', parents: 'parents.school.bg', students: 'students.school.bg' }

const graph = (pages: Record<string, unknown>[][]) => {
  const asked: string[] = []
  let page = 0

  const fetch = async (url: string, init?: RequestInit) => {
    asked.push(url)
    if (init?.method === 'POST') return Response.json({})
    const rows = pages[page] ?? []
    const more = page < pages.length - 1
    page++
    return Response.json({
      value: rows,
      ...(more ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/next?$skiptoken=p${page}` } : {}),
    })
  }

  return { asked, fetch }
}

const source = (pages: Record<string, unknown>[][], over = {}) =>
  microsoft365Source({
    calendarUser: 'terms@school.bg',
    documentsDriveId: 'drive-1',
    domains: DOMAINS,
    fetch: graph(pages).fetch as never,
    roles: { groups: { 'registrars@school.bg': 'registrar' } },
    token: () => 't',
    ...over,
  })

const user = (mail: string, over = {}) => ({ displayName: mail, id: mail, mail, ...over })

test('it follows the link Graph gives rather than rebuilding the query', async () => {
  const { asked, fetch } = graph([[user('a@school.bg')], [user('b@school.bg')], [user('c@school.bg')]])
  const m365 = microsoft365Source({
    domains: DOMAINS,
    fetch: fetch as never,
    roles: {},
    token: () => 't',
  })

  const people = await m365.listPeople()

  assert.equal(people.length, 3, 'paging stopped early')
  assert.match(asked[1]!, /\$skiptoken=p1/, 'the second request did not follow @odata.nextLink')
  assert.match(asked[2]!, /\$skiptoken=p2/)
})

test('a response with no next link ends the listing', async () => {
  const { asked } = graph([[user('a@school.bg')]])
  const people = await source([[user('a@school.bg')]]).listPeople()

  assert.equal(people.length, 1)
  void asked
})

test('pupils and parents are what their addressing says', async () => {
  const people = await source([
    [user('12a@students.school.bg'), user('12a@parents.school.bg'), user('dir@school.bg')],
  ]).listPeople()

  assert.equal(people[0]!.role, 'student')
  assert.equal(people[1]!.role, 'parent')
  assert.equal(people[2]!.role, undefined, 'a staff address was given a role by its domain')
})

test('a pupil and their parents resolve to the same class', async () => {
  const people = await source([
    [user('12a@students.school.bg'), user('12a@parents.school.bg')],
  ]).listPeople()

  assert.equal(people[0]!.class, '12a@students.school.bg')
  assert.equal(people[0]!.class, people[1]!.class)
})

/** Routes by path, so a memberOf lookup returns groups rather than users. */
const routed = (routes: Record<string, unknown[]>) => {
  const asked: string[] = []
  const fetch = async (url: string) => {
    asked.push(url)
    const key = Object.keys(routes).find((path) => url.includes(path))
    return Response.json({ value: key ? routes[key] : [] })
  }
  return { asked, fetch }
}

test('a pupil in a staff group stays a pupil', async () => {
  // Adding a child to the wrong group must not grant them a staff role. The
  // group lookup genuinely offers one here — an earlier version of this test
  // did not, and the guard could be deleted without anything failing.
  const { asked, fetch } = routed({
    '/memberOf': [{ id: 'g1', mail: 'registrars@school.bg' }],
    '/users': [user('12a@students.school.bg')],
  })

  const m365 = microsoft365Source({
    domains: DOMAINS,
    fetch: fetch as never,
    roles: { groups: { 'registrars@school.bg': 'registrar' } },
    token: () => 't',
  })

  const people = await m365.listPeople()

  assert.equal(people[0]!.role, 'student', 'a group promoted a pupil')
  assert.ok(!asked.some((url) => url.includes('/memberOf')), 'a pupil was looked up in groups at all')
})

test('a staff member in a mapped group gets that role', async () => {
  // The other half: the mapping has to work, or the test above passes for the
  // wrong reason.
  const { fetch } = routed({
    '/memberOf': [{ id: 'g1', mail: 'registrars@school.bg' }],
    '/users': [user('someone@school.bg')],
  })

  const m365 = microsoft365Source({
    domains: DOMAINS,
    fetch: fetch as never,
    roles: { groups: { 'registrars@school.bg': 'registrar' } },
    token: () => 't',
  })

  assert.equal((await m365.listPeople())[0]!.role, 'registrar')
})

test('the calendar is read through calendarView, with both bounds', async () => {
  // calendarView expands recurrence into the instances a school keeps, and
  // requires a start and an end.
  const { asked, fetch } = graph([[{ id: 'e1', isAllDay: true, start: { dateTime: '2026-09-15T00:00:00Z' }, subject: 'Term starts' }]])
  const m365 = microsoft365Source({
    calendarUser: 'terms@school.bg',
    domains: DOMAINS,
    fetch: fetch as never,
    roles: {},
    token: () => 't',
  })

  const dates = await m365.listCalendar({ from: '2026-09-01T00:00:00Z', until: '2027-07-01T00:00:00Z' })

  assert.match(asked[0]!, /calendarView/)
  assert.match(asked[0]!, /startDateTime=2026-09-01/)
  assert.match(asked[0]!, /endDateTime=2027-07-01/)
  assert.equal(dates[0]!.title, 'Term starts')
  assert.equal(dates[0]!.allDay, true)
})

test('a drive file with no link is not reachable', async () => {
  const withLink = await source([[{ id: 'f1', name: 'Rules', webUrl: 'https://sp/f1' }]]).listDocuments()
  const without = await source([[{ id: 'f2', name: 'Draft' }]]).listDocuments()

  assert.equal(withLink[0]!.reachable, true)
  assert.equal(without[0]!.reachable, false)
})

test('an audit entry states no reason rather than inventing one', async () => {
  // Entra records that a change happened and by whom. It has no field for why.
  const changes = await source([
    [
      {
        activityDateTime: '2026-09-01T00:00:00Z',
        activityDisplayName: 'Add member to role',
        initiatedBy: { user: { userPrincipalName: 'head@school.bg' } },
        targetResources: [{ userPrincipalName: 'x@school.bg' }],
      },
    ],
  ]).listAccessChanges()

  assert.equal(changes[0]!.reason, null)
  assert.equal(changes[0]!.subject, 'x@school.bg')
})

test('it refuses what Microsoft has no notion of, rather than answering empty', async () => {
  const m365 = source([[]])

  assert.equal(m365.capabilities.selections, false)
  await assert.rejects(() => m365.listSelections(), UnsupportedCapability)
  await assert.rejects(() => m365.listCheckpoints(), UnsupportedCapability)
})

test('a read-only deployment cannot be made to write', async () => {
  const m365 = source([[]])

  assert.equal(m365.capabilities.peopleWritable, false)
  await assert.rejects(() => m365.setRole('x@school.bg', 'teacher', 'a good reason'), UnsupportedCapability)
})

test('a role change demands a reason even where Entra has no field for it', async () => {
  const m365 = source([[]], { writablePeople: true })

  await assert.rejects(() => m365.setRole('x@school.bg', 'teacher', 'short'), /at least 8 characters/)
})

test('a role with no mapped group is refused rather than guessed at', async () => {
  const m365 = source([[]], { writablePeople: true })

  await assert.rejects(
    () => m365.setRole('x@school.bg', 'admin', 'promoting the deputy head'),
    /No group is mapped/,
  )
})

test('capabilities follow what was configured', async () => {
  const bare = microsoft365Source({ domains: DOMAINS, fetch: graph([[]]).fetch as never, roles: {}, token: () => 't' })

  assert.equal(bare.capabilities.calendar, false)
  assert.equal(bare.capabilities.documents, false)
  await assert.rejects(() => bare.listCalendar(), UnsupportedCapability)
  await assert.rejects(() => bare.listDocuments(), UnsupportedCapability)
})

test('permissions are the narrowest set for what is configured', () => {
  const reading = permissionsFor({ calendar: true, documents: true, groups: true })

  assert.ok(reading.includes(GRAPH_PERMISSIONS.people))
  assert.ok(!reading.includes(GRAPH_PERMISSIONS.peopleWrite), 'a read-only deployment can write')

  const writing = permissionsFor({ writablePeople: true })
  assert.ok(writing.includes(GRAPH_PERMISSIONS.peopleWrite))
  assert.ok(!writing.includes(GRAPH_PERMISSIONS.people), 'both people permissions were requested')
})

// EDUCATION. /education/classes/{id}/members returns pupils and staff in one
// collection with displayName and userPrincipalName on every row, and there is
// no Graph parameter that asks for less. The narrowing is this package's job,
// so the fixtures carry the full row.

const MEMBERS = [
  {
    displayName: 'Anna Petrova',
    id: 'm-anna',
    primaryRole: 'student',
    userPrincipalName: 'anna.petrova@students.school.bg',
  },
  {
    displayName: 'Boris Ivanov',
    id: 'm-boris',
    primaryRole: 'student',
    userPrincipalName: 'boris.ivanov@students.school.bg',
  },
  {
    displayName: 'Mariya Dimitrova',
    id: 'm-teacher',
    primaryRole: 'teacher',
    userPrincipalName: 'mariya@school.bg',
  },
  // Graph reports a member it classifies as neither. Guessing a role here is
  // how a draw acquires a candidate the school never enrolled.
  { displayName: 'Shared Mailbox', id: 'm-other', primaryRole: 'none' },
]

/** Routes by path, and answers a single resource bare rather than in `value`. */
const education = (over = {}) => {
  const asked: string[] = []

  const fetch = async (url: string) => {
    asked.push(url)
    if (url.includes('/members')) return Response.json({ value: MEMBERS })
    if (url.includes('/education/classes/c-1')) {
      return Response.json({ displayName: 'Year 12', id: 'c-1', mailNickname: '12a' })
    }
    if (url.includes('/education/classes')) {
      return Response.json({
        value: [
          { displayName: 'Year 12', id: 'c-1', mailNickname: '12a' },
          { displayName: 'Year 11', id: 'c-2', mailNickname: '11b' },
        ],
      })
    }
    return Response.json({ value: [] })
  }

  return {
    asked,
    source: microsoft365Source({
      domains: DOMAINS,
      education: true,
      fetch: fetch as never,
      roles: {},
      token: () => 't',
      ...over,
    }),
  }
}

test('a tenant without the education APIs refuses rather than answering an empty class', async () => {
  const { source: plain } = education({ education: false })

  assert.equal(plain.capabilities.rosters, false)
  await assert.rejects(() => plain.listClasses(), UnsupportedCapability)
  await assert.rejects(() => plain.listRoster('c-1'), UnsupportedCapability)
})

test('classes carry the group address the class is reachable at', async () => {
  // An educationClass is the Microsoft 365 group it shares an id with, so
  // mailNickname is the same thing Classroom calls courseGroupEmail.
  const { source } = education()
  const classes = await source.listClasses()

  assert.equal(classes.length, 2)
  assert.equal(classes[0]!.group, '12a@school.bg')
})

test('primaryRole decides who is a candidate, and anything else is dropped', async () => {
  // A teacher counted as a pupil is a teacher who can win a pupil's place.
  const { source } = education()
  const roster = await source.listRoster('c-1')

  assert.equal(roster.class.students, 2)
  assert.equal(roster.class.teachers, 1)
  assert.equal(roster.members.length, 3)
})

test('no name and no address reaches the caller, even though Graph sends both', async () => {
  const { source } = education()
  const rendered = JSON.stringify(await source.listRoster('c-1'))

  for (const leak of ['Anna Petrova', 'anna.petrova', 'Mariya', 'm-anna', 'students.school.bg']) {
    assert.ok(!rendered.includes(leak), `the roster carried ${leak}`)
  }
})

test('EduRoster is requested only by a school that reads rosters', async () => {
  assert.ok(!permissionsFor({}).includes(GRAPH_PERMISSIONS.rosters))
  assert.ok(permissionsFor({ rosters: true }).includes(GRAPH_PERMISSIONS.rosters))
  // Read, not ReadWrite: nothing here changes a child's enrolment.
  assert.ok(!permissionsFor({ rosters: true }).some((name) => name.includes('EduRoster.ReadWrite')))
})

test('the handle is keyed on the Entra id, never on the principal name', async () => {
  const { source } = education()
  const handles = (await source.listRoster('c-1')).members.map((member) => member.handle)

  assert.ok(handles.includes(await handleFor('c-1', 'm-anna')))
  assert.ok(!handles.includes(await handleFor('c-1', 'anna.petrova@students.school.bg')))
})
