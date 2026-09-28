import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { payloadSource } from './payload.js'
import { handleFor } from './roster.js'

// A SOURCE BOUNDARY MUST NOT BE A WAY ROUND THE CONFINEMENT. The port exists so
// a school running on Google keeps its people in Directory rather than copying
// them here. That is only safe if every adapter reads the way the tools did —
// access control on, confined to the requesting school. These tests watch the
// arguments the adapter actually sends.

const TENANTS = [
  { domain: 'a.school.bg', id: 1 },
  { domain: 'b.school.bg', id: 2 },
]

const ROWS: Record<string, Record<string, unknown>[]> = {
  documents: [
    { filename: 'r.pdf', id: 1, tenant: 1, title: 'Правилник за дейността' },
    { filename: 's.pdf', id: 2, tenant: 2, title: 'Стратегия за развитие' },
  ],
  users: [
    { class: '12a', email: 'a@a.bg', id: 1, role: 'teacher', tenant: 1, tenants: [{ tenant: 1 }] },
    { class: '12a', email: 'b@b.bg', id: 2, role: 'admin', tenant: 2, tenants: [{ tenant: 2 }] },
    { class: '12a', email: 'p1@a.bg', id: 3, role: 'student', tenant: 1, tenants: [{ tenant: 1 }] },
    { class: '12a', email: 'p2@a.bg', id: 4, role: 'student', tenant: 1, tenants: [{ tenant: 1 }] },
    // A parent carries their child's class and is not in it.
    { class: '12a', email: 'm1@a.bg', id: 5, role: 'parent', tenant: 1, tenants: [{ tenant: 1 }] },
    { class: '11b', email: 'p3@a.bg', id: 6, role: 'student', tenant: 1, tenants: [{ tenant: 1 }] },
  ],
}


/** A host that records a tenant on these collections, as tenantFieldOf reads it. */
const TENANTED = {
  documents: { config: { flattenedFields: [{ name: 'title' }, { name: 'tenant' }] } },
  'random-selections': { config: { flattenedFields: [{ name: 'seq' }, { name: 'tenant' }] } },
  users: {
    config: { flattenedFields: [{ name: 'email' }, { name: 'tenants', flattenedFields: [{ name: 'tenant' }] }] },
  },
}

const harness = (host: string) => {
  const seen: Record<string, unknown>[] = []

  /**
   * The school a `where` confines to, under either path this host records it
   * at: `tenant` on a register, `tenants.tenant` on a user, which is the
   * nested shape TENANT_PATH names and tenantFieldOf resolves.
   */
  const tenantIn = (where: unknown): number | undefined => {
    const paths = ['tenant', 'tenants.tenant']
    const read = (clause: Record<string, { equals?: number }> | undefined) => {
      for (const path of paths) {
        if (clause?.[path]?.equals !== undefined) return clause[path]!.equals
      }
      return undefined
    }

    const clause = where as { and?: unknown[] } & Record<string, { equals?: number }>
    const direct = read(clause)
    if (direct !== undefined) return direct

    for (const part of clause?.and ?? []) {
      const found = read(part as Record<string, { equals?: number }>)
      if (found !== undefined) return found
    }
    return undefined
  }

  const payload = {
    collections: TENANTED as never,
    count: async (args: Record<string, unknown>) => {
      seen.push(args)
      return { totalDocs: args.collection === 'tenants' ? TENANTS.length : 0 }
    },
    find: async (args: Record<string, unknown>) => {
      seen.push(args)
      if (args.collection === 'tenants') {
        const where = args.where as { domain?: { equals?: string } } | undefined
        const docs = where?.domain ? TENANTS.filter((t) => t.domain === where.domain!.equals) : TENANTS
        return { docs, hasNextPage: false, totalDocs: where ? docs.length : TENANTS.length }
      }
      const rows = ROWS[String(args.collection)] ?? []
      const scope = tenantIn(args.where)
      const docs = scope === undefined ? rows : rows.filter((r) => r.tenant === scope)
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
  }

  const req = { headers: new Headers({ host }), payload } as unknown as PayloadRequest
  return { req, seen, source: payloadSource(req) }
}

test('documents are confined to the requesting school', async () => {
  const a = harness('a.school.bg')
  const b = harness('b.school.bg')

  assert.deepEqual((await a.source.listDocuments()).map((d) => d.title), ['Правилник за дейността'])
  assert.deepEqual((await b.source.listDocuments()).map((d) => d.title), ['Стратегия за развитие'])
})

test('every read the adapter issues requests access control', async () => {
  const { seen, source } = harness('a.school.bg')
  await source.listDocuments()
  await source.listPeople()

  const audited = seen.filter((call) => call.collection !== 'tenants')
  assert.ok(audited.length > 0, 'the adapter issued no reads to audit')
  for (const call of audited) {
    assert.equal(call.overrideAccess, false, `${String(call.collection)} read with access control off`)
  }
})

test('the roster is the one read past the user gate, and only it', async () => {
  // Named rather than left implicit: a roster assembled from the rows one
  // caller happens to see would seal a commitment that disagreed with the
  // draw's — a partial answer wearing a full answer's hash. What leaves is a
  // list of handles, which is the same trade the inclusion proof makes.
  const { seen, source } = harness('a.school.bg')
  await source.listRoster('12a')

  const widened = seen.filter(
    (call) => call.collection !== 'tenants' && call.overrideAccess === true,
  )

  assert.deepEqual(
    [...new Set(widened.map((call) => String(call.collection)))],
    ['users'],
    'something other than the roster reads past the user gate',
  )
  // Confinement to this school is not what was widened, and cannot be.
  for (const call of widened) {
    assert.notEqual(call.where, undefined, 'the roster read left this school unscoped')
  }
})

test('an unresolved host on a multi-school instance refuses rather than spans', async () => {
  const { source } = harness('unknown.example.com')
  await assert.rejects(() => source.listDocuments(), /without a tenant/)
})

test('reachability is carried across the port, not re-derived by each caller', async () => {
  // The compliance engine must tell "recorded" from "published", whichever
  // system the documents actually live in.
  const { source } = harness('a.school.bg')
  const [document] = await source.listDocuments()

  assert.equal(document!.reachable, true)
})

test('a source states what it can do, so a tool is never offered then refused', async () => {
  const { source } = harness('a.school.bg')

  assert.equal(source.capabilities.selections, true)
  assert.equal(typeof source.capabilities.peopleWritable, 'boolean')
})

test('a class is the set of people who share one, and a parent is not in it', async () => {
  const { source } = harness('a.school.bg')
  const classes = await source.listClasses()

  const twelveA = classes.find((klass) => klass.id === '12a')
  assert.equal(twelveA?.students, 2)
  // The teacher, not the parent.
  assert.equal(twelveA?.teachers, 1)
  assert.deepEqual(classes.map((klass) => klass.id), ['11b', '12a'])
})

test('a roster of the other school’s class is empty here, not somebody else’s', async () => {
  // The whole register is read past the user gate; the school filter is not
  // one of the things that can be switched off.
  const b = harness('b.school.bg')
  const roster = await b.source.listRoster('12a')

  assert.equal(roster.class.students, 0)
  assert.equal(roster.class.teachers, 1)
})

test('the local roster carries no email and no name either', async () => {
  const { source } = harness('a.school.bg')
  const rendered = JSON.stringify(await source.listRoster('12a'))

  for (const leak of ['p1@a.bg', 'a@a.bg', 'm1@a.bg']) {
    assert.ok(!rendered.includes(leak), `the roster carried ${leak}`)
  }
})

test('the local handle is keyed on the row id, never on the address', async () => {
  const { source } = harness('a.school.bg')
  const handles = (await source.listRoster('12a')).members.map((member) => member.handle)

  assert.ok(handles.includes(await handleFor('12a', '3')))
  assert.ok(!handles.includes(await handleFor('12a', 'p1@a.bg')))
})
