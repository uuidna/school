import type { PayloadRequest } from 'payload'

import type { UserVersion } from '../plugins/rbac/versions.js'

import { accessChangesFromVersions } from '../plugins/rbac/versions.js'

import type {
  AccessChange,
  ClassRoster,
  SchoolClass,
  SealedCheckpoint,
  Person,
  SchoolDate,
  SchoolDocument,
  SchoolGroup,
  SchoolRoleName,
  SchoolSource,
  SelectionRecord,
} from './types.js'

import { bounded } from './untrusted.js'
import { countAll, findAll } from '../payload/findAll.js'
import { andWhere, tenantOf, tenantWhere } from '../payload/scope.js'
import { sealRoster } from './roster.js'

/**
 * The Payload-backed source: this package's own host, and the reference
 * implementation of the port.
 *
 * Everything here reads through the scoped path — access control on, confined
 * to the requesting school, failing closed on an unresolved host — so a source
 * boundary cannot be used to slip past the confinement those reads enforce.
 */
/**
 * Access changes, read out of Payload's own version history.
 *
 * THERE IS NO LOG COLLECTION. `access-log` held eight fields and six restated
 * a document Payload already versions, so the trail IS the history and the two
 * facts a version cannot supply — who changed it and why — ride on the user
 * document, stamped before the save.
 *
 * MORE VERSIONS ARE FETCHED THAN CHANGES ARE WANTED, and deliberately. A
 * version is written for every edit, and only some are role changes; asking
 * for twenty versions to answer "the last twenty access changes" would return
 * however many of those twenty happened to be role changes. The window is
 * widened and the result truncated, so the number asked for is the number that
 * comes back when that many exist.
 */
const VERSION_WINDOW = 20

const listAccessChangesFromVersions = async (
  req: PayloadRequest,
  { limit, subject }: { limit: number; subject?: string },
): Promise<AccessChange[]> => {
  const { docs } = await req.payload.findVersions({
    collection: 'users',
    depth: 0,
    // A change needs its predecessor, so the window is wider than the answer.
    // `limit: 0` means "count them all", and Payload reads that the same way.
    limit: limit === 0 ? 0 : (limit + 1) * VERSION_WINDOW,
    overrideAccess: false,
    req,
    sort: '-updatedAt',
    ...(subject ? { where: { 'version.email': { equals: subject } } } : {}),
  })

  const changes = accessChangesFromVersions(docs as UserVersion[])
  return limit === 0 ? changes : changes.slice(0, limit)
}

export const payloadSource = (req: PayloadRequest): SchoolSource => ({
  capabilities: {
    audit: true,
    calendar: true,
    content: true,
    groups: true,
    documents: true,
    people: true,
    peopleWritable: true,
    rosters: true,
    selections: true,
  },

  /**
   * How many access changes there are, counted from the version history.
   *
   * Payload does not offer a count of versions matching a predicate, so this
   * derives it the same way the listing does — a role change is a difference
   * between adjacent versions, and only the reading knows which differences
   * are role changes.
   */
  countAccessChanges: async () => (await listAccessChangesFromVersions(req, { limit: 0 })).length,

  findPersonByEmail: async (email) => {
    const scope = await tenantWhere(req.payload, req, 'users')
    const { docs } = await req.payload.find({
      collection: 'users',
      depth: 1,
      limit: 1,
      overrideAccess: false,
      req,
      where: andWhere(scope, { email: { equals: email.toLowerCase().trim() } }),
    })
    return docs[0] ? toPerson(docs[0] as Record<string, unknown>) : undefined
  },

  listAccessChanges: async ({ limit = 20, subject } = {}) =>
    listAccessChangesFromVersions(req, { limit, ...(subject ? { subject } : {}) }),

  listCalendar: async ({ from, until } = {}) => {
    const dates = await findAll<Record<string, unknown>>(req.payload, {
      collection: 'school-calendar',
      req,
      sort: 'starts',
      ...(from || until
        ? {
            where: {
              and: [
                ...(from ? [{ starts: { greater_than_equal: from } }] : []),
                ...(until ? [{ starts: { less_than_equal: until } }] : []),
              ],
            },
          }
        : {}),
    })

    return dates.map(
      (date): SchoolDate => ({
        allDay: date.allDay === true,
        ...(date.ends ? { ends: String(date.ends) } : {}),
        id: String(date.id),
        ...(date.starts ? { starts: String(date.starts) } : {}),
        title: bounded(date.title),
      }),
    )
  },

  /**
   * A class is the set of people who share one.
   *
   * The self-hosted school has no course register, and inventing one would
   * mean a second place where a class exists — free to disagree with the
   * people in it, which is exactly the failure the group listing avoids by
   * deriving rather than storing. So a class here is a value of the `class`
   * field, the same string a Workspace school's class group is addressed by.
   *
   * Counted, not listed: this answers how big 12a is, and `listRoster`
   * answers who is in it, pseudonymously. Parents carry their child's class
   * and are not in it, so they are counted in neither figure.
   */
  listClasses: async (): Promise<SchoolClass[]> => {
    const people = await membersByClass(req)

    return [...people.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, members]): SchoolClass => ({
        group: id,
        id,
        name: id,
        students: members.filter((member) => member.role === 'student').length,
        teachers: members.filter((member) => member.role === 'teacher').length,
      }))
  },

  /**
   * Read past the user gate, and confined to this school, for the same reason
   * an inclusion proof is: what leaves here is a list of handles. A roster
   * assembled from only the rows one caller may read would seal a commitment
   * that disagreed with the draw's — a partial answer wearing a full answer's
   * hash, which is the failure this package exists to refuse.
   */
  listRoster: async (classId: string): Promise<ClassRoster> => {
    const wanted = classId.trim().toLowerCase()
    const members = (await membersByClass(req)).get(wanted) ?? []

    return sealRoster({ group: wanted, id: wanted, name: wanted }, members)
  },

  listCheckpoints: () =>
    findAll<SealedCheckpoint>(req.payload, { collection: 'receipt-roots', req, sort: '-sealedAt' }),

  listDocuments: async () => {
    const docs = await findAll<Record<string, unknown>>(req.payload, {
      collection: 'documents',
      req,
    })
    return docs.map((doc) => ({
      category: doc.category as string,
      id: doc.id as number | string,
      legalBasis: doc.legalBasis as string,
      // Recorded is not published: a row with no file and no link is an
      // intention, and the compliance engine must be able to tell them apart.
      reachable: Boolean(doc.filename) || Boolean(doc.url) || Boolean(doc.link),
      title: bounded(doc.title),
      url: (doc.url as string) ?? (doc.link as string) ?? null,
    })) satisfies SchoolDocument[]
  },

  /**
   * A class is a group here.
   *
   * The self-hosted equivalent of a Google Group is the set of people who
   * share a class — the same concept the draw addressing is already built on,
   * derived rather than kept in a second register that could disagree with the
   * people in it.
   */
  listGroups: async () => {
    const people = await findAll<Record<string, unknown>>(req.payload, {
      collection: 'users',
      req,
    })

    const counted = new Map<string, number>()
    for (const person of people) {
      const group = typeof person.class === 'string' ? person.class.trim().toLowerCase() : ''
      if (group) counted.set(group, (counted.get(group) ?? 0) + 1)
    }

    return [...counted.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([email, members]): SchoolGroup => ({ email, id: email, members, name: email }))
  },

  listPeople: async () => {
    const docs = await findAll<Record<string, unknown>>(req.payload, {
      collection: 'users',
      depth: 1,
      req,
      sort: 'email',
    })
    return docs.map(toPerson)
  },

  listSelections: () =>
    findAll<SelectionRecord>(req.payload, { collection: 'random-selections', req, sort: 'seq' }),

  recordDocument: async (document) => {
    const scope = await tenantWhere(req.payload, req, 'documents')
    const existing = await req.payload.find({
      collection: 'documents',
      limit: 1,
      overrideAccess: false,
      req,
      where: andWhere(scope, { title: { equals: document.title } }),
    })

    const tenant = await tenantOf(req.payload, req)
    const data = { ...document, ...(tenant ? { tenant: tenant.id } : {}) }

    const saved = existing.docs[0]
      ? await req.payload.update({
          collection: 'documents',
          data: data as never,
          id: existing.docs[0].id,
          overrideAccess: false,
          req,
        })
      : await req.payload.create({
          collection: 'documents',
          data: data as never,
          overrideAccess: false,
          req,
        })

    return { action: existing.docs[0] ? ('updated' as const) : ('created' as const), id: saved.id }
  },

  schoolRef: async () => {
    const tenant = await tenantOf(req.payload, req)
    return tenant as null | { id: number | string; jurisdiction?: string }
  },

  setRole: async (email, role: SchoolRoleName, reason) => {
    const scope = await tenantWhere(req.payload, req, 'users')
    const { docs } = await req.payload.find({
      collection: 'users',
      limit: 1,
      overrideAccess: false,
      req,
      where: andWhere(scope, { email: { equals: email.toLowerCase().trim() } }),
    })

    const person = docs[0]
    if (!person) throw new Error(`No account for ${email}`)

    const updated = await req.payload.update({
      collection: 'users',
      // Read back by stampAccessChange, so the reason travels with the change
      // and lands inside the version Payload writes.
      context: { accessReason: reason },
      data: { role },
      id: person.id,
      overrideAccess: false,
      req,
    })

    return { before: (person as { role?: string }).role, id: updated.id }
  },
})

/**
 * Everyone, grouped by the class they are in.
 *
 * One read rather than one per class: a school of forty classes would
 * otherwise make forty full passes over its people, and the grouping is the
 * same each time.
 *
 * A staff role means a teacher of the class; `parent` is carried through
 * unchanged so `sealRoster` is the single place that drops them, rather than
 * each source deciding separately whether a parent is in their child's class.
 */
const membersByClass = async (
  req: PayloadRequest,
): Promise<Map<string, { id: string; role: 'parent' | 'student' | 'teacher' }[]>> => {
  const people = await findAll<Record<string, unknown>>(req.payload, {
    collection: 'users',
    overrideAccess: true,
    req,
  })

  const byClass = new Map<string, { id: string; role: 'parent' | 'student' | 'teacher' }[]>()

  for (const person of people) {
    const klass = typeof person.class === 'string' ? person.class.trim().toLowerCase() : ''
    if (!klass) continue

    const role =
      person.role === 'student' ? 'student' : person.role === 'parent' ? 'parent' : 'teacher'

    byClass.set(klass, [...(byClass.get(klass) ?? []), { id: String(person.id), role }])
  }

  return byClass
}

const toPerson = (doc: Record<string, unknown>): Person => ({
  /**
   * The class, which this adapter alone was dropping.
   *
   * Workspace and Microsoft 365 both derive it from the addressing and put it
   * on the person; the local store held it on the row and did not carry it
   * across. So `school_access_review` answered "who can see pupils' data" with
   * a class for a school on Google and without one for a school on its own
   * database — and the class is exactly what bounds a parent or a pupil, which
   * makes it the field a review of THEIR access most needs.
   *
   * Found by a test of the tool rather than of the adapter: the sovereignty
   * check compares capabilities, and a field quietly absent from one source's
   * answer is not a capability.
   */
  ...(typeof doc.class === 'string' && doc.class.trim() ? { class: doc.class.trim() } : {}),
  email: String(doc.email ?? ''),
  id: doc.id as number | string,
  name: (doc.name as string) ?? undefined,
  role: doc.role as Person['role'],
  school: ((doc.tenants ?? []) as { tenant?: { name?: string } | number }[])
    .map((entry) => (typeof entry.tenant === 'object' && entry.tenant ? entry.tenant.name : entry.tenant))
    .filter(Boolean)
    .join(', '),
})
