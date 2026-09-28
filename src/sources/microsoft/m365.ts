import type {
  AccessChange,
  ClassRoster,
  Person,
  SchoolClass,
  SchoolDate,
  SchoolDocument,
  SchoolGroup,
  SchoolRoleName,
  SchoolSource,
  SealedCheckpoint,
  SelectionRecord,
} from '../types.js'
import type { GraphOptions } from './api.js'

import { bounded } from '../untrusted.js'
import { UnsupportedCapability } from '../types.js'
import { sealRoster } from '../roster.js'
import { GRAPH, graphApi } from './api.js'

/**
 * A school's Microsoft 365, as a source.
 *
 * The same five capability groups Workspace answers, from Entra ID, Calendar
 * and SharePoint. A school choosing Microsoft is not choosing a smaller
 * package, and a school choosing neither is not either — the self-hosted store
 * answers everything, and a test fails if any adapter gains a capability the
 * local one lacks.
 *
 * What Microsoft has no notion of is the same as what Google has none of: a
 * draw nobody can rig, a receipt chain, a statutory publication list. Those are
 * what this package adds, and this adapter declares their absence rather than
 * answering with an empty list — a source returning [] for listSelections
 * would make the fairness audit report an intact chain of zero receipts.
 *
 * Role derivation follows the same rule as Workspace: pupils and parents are
 * what their addressing says they are, and a group cannot promote them. Staff
 * roles come from group membership, stated by the school rather than guessed,
 * because every member of staff shares the primary domain and an address
 * cannot tell a registrar from a teacher.
 */

export type M365RoleMapping = {
  /** Group id or address → the role its members hold. */
  groups?: Record<string, SchoolRoleName>
}

export type M365SourceOptions = GraphOptions & {
  /** Calendar to read term dates from — a group's, or a user's. */
  calendarUser?: string
  /** SharePoint drive holding the statutory document typology. */
  documentsDriveId?: string
  /**
   * Whether this school's classes live in the education APIs.
   *
   * Graph keeps them under /education, which a tenant only has where the
   * school is provisioned for Education. A flag rather than an id: there is
   * nothing to point at, and a school without it would have this package
   * holding EduRoster for an endpoint that answers 404.
   */
  education?: boolean
  /** Pupil and parent domains, as the school addresses them. */
  domains: { base: string; parents: string; students: string }
  roles: M365RoleMapping
  writablePeople?: boolean
}

type GraphUser = {
  displayName?: string
  id?: string
  mail?: string
  userPrincipalName?: string
}

type GraphGroup = { displayName?: string; id?: string; mail?: string }

type EducationClass = {
  classCode?: string
  displayName?: string
  externalName?: string
  id?: string
  mailNickname?: string
}

/** An educationUser, of which this reads the two fields it needs. */
type EducationMember = { id?: string; primaryRole?: string }

type GraphEvent = {
  end?: { dateTime?: string }
  id?: string
  isAllDay?: boolean
  start?: { dateTime?: string }
  subject?: string
}

type GraphItem = { id?: string; name?: string; webUrl?: string }

type GraphAudit = {
  activityDateTime?: string
  activityDisplayName?: string
  initiatedBy?: { user?: { userPrincipalName?: string } }
  targetResources?: { userPrincipalName?: string }[]
}

export const microsoft365Source = (options: M365SourceOptions): SchoolSource => {
  const api = graphApi(options)
  const { domains, roles } = options

  const addressOf = (user: GraphUser) => (user.mail ?? user.userPrincipalName ?? '').toLowerCase()

  const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1)

  const classOfUser = (address: string): string | undefined => {
    const domain = domainOf(address)
    if (domain !== domains.students && domain !== domains.parents) return undefined
    return `${address.slice(0, address.lastIndexOf('@'))}@${domains.students}`
  }

  const roleOf = (address: string): SchoolRoleName | undefined => {
    const domain = domainOf(address)
    // What they are by addressing, whatever a group says.
    if (domain === domains.students) return 'student'
    if (domain === domains.parents) return 'parent'
    return undefined
  }

  const toPerson = (user: GraphUser): Person => {
    const email = addressOf(user)
    const klass = classOfUser(email)

    return {
      ...(klass ? { class: klass } : {}),
      email,
      id: user.id ?? email,
      ...(user.displayName ? { name: user.displayName } : {}),
      role: roleOf(email),
    }
  }

  /** Group membership decides a staff role the address cannot. */
  const withGroupRole = async (person: Person): Promise<Person> => {
    if (!roles.groups || Object.keys(roles.groups).length === 0) return person

    const domain = domainOf(person.email)
    // A pupil or parent placed in a staff group stays what they are.
    if (domain === domains.students || domain === domains.parents) return person

    const groups = await api.listAll<GraphGroup>(
      `${GRAPH}/users/${encodeURIComponent(person.email)}/memberOf`,
    )

    for (const group of groups) {
      const mapped =
        (group.mail ? roles.groups[group.mail.toLowerCase()] : undefined) ??
        (group.id ? roles.groups[group.id] : undefined)
      if (mapped) return { ...person, role: mapped }
    }

    return person
  }

  return {
    capabilities: {
      audit: true,
      calendar: Boolean(options.calendarUser),
      // Microsoft 365 is not this school's website.
      content: false,
      documents: Boolean(options.documentsDriveId),
      groups: true,
      people: true,
      peopleWritable: options.writablePeople === true,
      rosters: options.education === true,
      // The thing this package adds. Declared absent, never answered empty.
      selections: false,
    },

    countAccessChanges: async () =>
      (await api.listAll<GraphAudit>(`${GRAPH}/auditLogs/directoryAudits`)).length,

    findPersonByEmail: async (email) => {
      const key = email.trim().toLowerCase()
      try {
        const user = await api.call<GraphUser>(`${GRAPH}/users/${encodeURIComponent(key)}`)
        return await withGroupRole(toPerson(user))
      } catch (error) {
        if ((error as { status?: number }).status === 404) return undefined
        throw error
      }
    },

    listAccessChanges: async ({ limit = 20, subject } = {}) => {
      const entries = await api.listAll<GraphAudit>(`${GRAPH}/auditLogs/directoryAudits`)

      const changes = entries.map(
        (entry): AccessChange => ({
          action: entry.activityDisplayName,
          actor: entry.initiatedBy?.user?.userPrincipalName,
          at: entry.activityDateTime,
          // Entra records that a change happened and by whom. It has no field
          // for why, which is what art. 5(2) asks for.
          reason: null,
          subject: entry.targetResources?.[0]?.userPrincipalName,
        }),
      )

      const filtered = subject
        ? changes.filter((change) => change.subject?.toLowerCase() === subject.toLowerCase())
        : changes

      return filtered.slice(0, limit)
    },

    listCalendar: async ({ from, until } = {}) => {
      const who = options.calendarUser
      if (!who) throw new UnsupportedCapability('calendar', 'Microsoft 365')

      const url = new URL(`${GRAPH}/users/${encodeURIComponent(who)}/calendarView`)
      // calendarView expands recurrence into the instances a school keeps, and
      // requires both bounds.
      url.searchParams.set('startDateTime', from ?? new Date().toISOString())
      url.searchParams.set(
        'endDateTime',
        until ?? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      )

      const events = await api.listAll<GraphEvent>(url.toString())

      return events.map(
        (event): SchoolDate => ({
          allDay: event.isAllDay === true,
          ...(event.end?.dateTime ? { ends: event.end.dateTime } : {}),
          id: event.id ?? '',
          ...(event.start?.dateTime ? { starts: event.start.dateTime } : {}),
          title: bounded(event.subject),
        }),
      )
    },

    /**
     * The classes this tenant teaches.
     *
     * An educationClass is the Microsoft 365 group it shares an id with, so
     * `mailNickname` is the class group address — the same thing Classroom
     * calls `courseGroupEmail` and the local store calls the class field. The
     * three systems name it differently and mean one thing, which is what the
     * port exists to say.
     *
     * Graph has no equivalent of Classroom's course state: a class that is
     * over is deleted or left in place by the school's own sync, so nothing
     * here filters on a state that does not exist.
     */
    listClasses: async (): Promise<SchoolClass[]> => {
      if (options.education !== true) throw new UnsupportedCapability('rosters', 'Microsoft 365')

      const classes = await api.listAll<EducationClass>(`${GRAPH}/education/classes`)

      return classes.map(
        (klass): SchoolClass => ({
          ...(klass.mailNickname ? { group: `${klass.mailNickname}@${domains.base}` } : {}),
          id: klass.id ?? '',
          name: bounded(klass.displayName ?? klass.externalName ?? klass.classCode) || (klass.id ?? ''),
        }),
      )
    },

    /**
     * One class's roster, as handles.
     *
     * One call rather than two: /members returns pupils and staff together and
     * `primaryRole` tells them apart, which is the field the draw depends on —
     * a teacher counted as a pupil is a teacher who can win a pupil's place.
     * Anything Graph reports as neither is dropped rather than guessed into a
     * role, and the sealed counts then disagree with the class list, which is
     * the visible symptom of a directory that needs looking at.
     */
    listRoster: async (classId: string): Promise<ClassRoster> => {
      if (options.education !== true) throw new UnsupportedCapability('rosters', 'Microsoft 365')

      const id = encodeURIComponent(classId)

      const [klass, members] = await Promise.all([
        api.call<EducationClass>(`${GRAPH}/education/classes/${id}`),
        api.listAll<EducationMember>(`${GRAPH}/education/classes/${id}/members`),
      ])

      return sealRoster(
        {
          ...(klass.mailNickname ? { group: `${klass.mailNickname}@${domains.base}` } : {}),
          id: klass.id ?? classId,
          name: klass.displayName ?? klass.externalName ?? classId,
        },
        members
          .filter(
            (member): member is EducationMember & { primaryRole: 'student' | 'teacher' } =>
              member.primaryRole === 'student' || member.primaryRole === 'teacher',
          )
          // displayName and userPrincipalName arrive in the same payload and
          // are not read. Graph has no way to ask for less, so the narrowing
          // happens here, once, on the way into the seal.
          .map((member) => ({ id: member.id ?? '', role: member.primaryRole })),
      )
    },

    listCheckpoints: async (): Promise<SealedCheckpoint[]> => {
      throw new UnsupportedCapability('selections', 'Microsoft 365')
    },

    listDocuments: async () => {
      const drive = options.documentsDriveId
      if (!drive) throw new UnsupportedCapability('documents', 'Microsoft 365')

      const items = await api.listAll<GraphItem>(
        `${GRAPH}/drives/${encodeURIComponent(drive)}/root/children`,
      )

      return items.map(
        (item): SchoolDocument => ({
          id: item.id ?? '',
          // A file in the folder is the published artefact, provided it has a
          // link somebody can open.
          reachable: Boolean(item.webUrl),
          title: bounded(item.name),
          url: item.webUrl ?? null,
        }),
      )
    },

    listGroups: async () => {
      const groups = await api.listAll<GraphGroup>(`${GRAPH}/groups`)

      return groups.map(
        (group): SchoolGroup => ({
          email: (group.mail ?? '').toLowerCase(),
          id: group.id ?? group.mail ?? '',
          name: group.displayName ?? group.mail ?? '',
        }),
      )
    },

    listPeople: async () => {
      const users = await api.listAll<GraphUser>(`${GRAPH}/users`)
      const people = users.map(toPerson)

      if (!roles.groups) return people
      return Promise.all(people.map(withGroupRole))
    },

    listSelections: async (): Promise<SelectionRecord[]> => {
      throw new UnsupportedCapability('selections', 'Microsoft 365')
    },

    recordDocument: async () => {
      throw new UnsupportedCapability('documents', 'Microsoft 365 (read-only)')
    },

    schoolRef: async () => ({ id: domains.base }),

    setRole: async (email, role, reason) => {
      if (options.writablePeople !== true) {
        throw new UnsupportedCapability('peopleWritable', 'Microsoft 365')
      }

      // Entra has no field for why. The reason belongs in this package's own
      // append-only log; it is required here so no caller changes a role
      // through this path without stating one.
      if (reason.trim().length < 8) {
        throw new Error('A reason of at least 8 characters is required to change a role')
      }

      const group = Object.entries(options.roles.groups ?? {}).find(([, value]) => value === role)
      if (!group) {
        throw new Error(
          `No group is mapped to the role "${role}", so this package cannot grant it without inventing where the school keeps that role.`,
        )
      }

      const person = await api.call<GraphUser>(`${GRAPH}/users/${encodeURIComponent(email.trim().toLowerCase())}`)

      await api.call(`${GRAPH}/groups/${encodeURIComponent(group[0])}/members/$ref`, {
        body: JSON.stringify({ '@odata.id': `${GRAPH}/directoryObjects/${person.id}` }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })

      return { before: roleOf(addressOf(person)), id: person.id ?? email }
    },
  }
}
