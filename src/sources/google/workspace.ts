import type {
  AccessChange,
  ClassRoster,
  Person,
  SchoolClass,
  SchoolDocument,
  SchoolDate,
  SchoolGroup,
  SchoolRoleName,
  SchoolSource,
  SealedCheckpoint,
  SelectionRecord,
} from '../types.js'
import type { GoogleApiOptions } from './api.js'
import type { WorkspaceDomains } from './identity.js'

import { bounded } from '../untrusted.js'
import { UnsupportedCapability } from '../types.js'
import { sealRoster } from '../roster.js'
import { CALENDAR, CLASSROOM, DIRECTORY, DRIVE, googleApi, REPORTS } from './api.js'

/**
 * A school's Google Workspace, as a source.
 *
 * This is the "extends, does not replace" case made concrete. The school's
 * people stay in Directory and its documents stay in Drive; nothing is copied
 * here. What Workspace has, this reads. What Workspace has no concept of — a
 * draw nobody can rig, a receipt chain, a statutory publication list — it
 * declares it cannot provide, and those are exactly the things this package
 * contributes on top.
 *
 * Declaring the gap is the point. A source that silently returned an empty
 * list for `listSelections` would make `school_fairness_audit` report an intact
 * chain of zero receipts, which is a false clean bill of health. It throws.
 */

export type WorkspaceRoleMapping = {
  /** Group address → the role its members hold, e.g. 'registrars@school.bg'. */
  groups?: Record<string, SchoolRoleName>
  /** Org unit path → role, e.g. '/Staff/Teachers'. Groups win where both match. */
  orgUnits?: Record<string, SchoolRoleName>
}

export type WorkspaceSourceOptions = GoogleApiOptions & {
  /** Drive folder holding the statutory document typology. */
  /** The calendar carrying term dates and closures. 'primary' for the school's own. */
  calendarId?: string
  /**
   * Whether this school teaches through Google Classroom.
   *
   * A flag rather than an id: Classroom holds every course the domain runs,
   * and there is nothing to point at. Off by default, because a school that
   * does not use Classroom would otherwise have this package requesting the
   * roster scope for an empty answer.
   */
  classroom?: boolean
  documentsFolderId?: string
  domains: WorkspaceDomains
  /**
   * How staff roles are decided.
   *
   * Required, and deliberately not defaulted. Every staff member shares the
   * primary domain, so the address distinguishes staff from pupils and cannot
   * distinguish a registrar from a teacher. Guessing that mapping would hand
   * somebody a role the school never granted.
   */
  roles: WorkspaceRoleMapping
  /** Set true only where the deployment intends role changes through this package. */
  writablePeople?: boolean
}

type DirectoryUser = {
  id?: string
  name?: { fullName?: string }
  orgUnitPath?: string
  primaryEmail?: string
  suspended?: boolean
}

type Course = {
  courseGroupEmail?: string
  courseState?: string
  id?: string
  name?: string
  section?: string
}

/** Student and Teacher differ only in the collection they arrive in. */
type CourseMember = { userId?: string }

type DriveFile = {
  id?: string
  mimeType?: string
  name?: string
  trashed?: boolean
  webViewLink?: string
}

type AuditActivity = {
  actor?: { email?: string }
  events?: { name?: string; parameters?: { name?: string; value?: string }[] }[]
  id?: { time?: string }
}

export const googleWorkspaceSource = (options: WorkspaceSourceOptions): SchoolSource => {
  const api = googleApi(options)
  const { domains, roles } = options

  const roleOf = (user: DirectoryUser): SchoolRoleName | undefined => {
    const email = user.primaryEmail?.toLowerCase() ?? ''
    const domain = email.slice(email.lastIndexOf('@') + 1)

    // Pupils and parents are what they are by domain, whatever groups say.
    if (domain === domains.students) return 'student'
    if (domain === domains.parents) return 'parent'

    const unit = user.orgUnitPath
    return unit ? roles.orgUnits?.[unit] : undefined
  }

  const classOfUser = (user: DirectoryUser): string | undefined => {
    const email = user.primaryEmail?.toLowerCase() ?? ''
    const domain = email.slice(email.lastIndexOf('@') + 1)
    if (domain !== domains.students && domain !== domains.parents) return undefined
    // Both audiences of a class resolve to the same class group, which is the
    // scope a draw runs over.
    return `${email.slice(0, email.lastIndexOf('@'))}@${domains.students}`
  }

  const toPerson = (user: DirectoryUser): Person => ({
    ...(classOfUser(user) ? { class: classOfUser(user) } : {}),
    email: user.primaryEmail ?? '',
    id: user.id ?? user.primaryEmail ?? '',
    name: user.name?.fullName,
    role: roleOf(user),
    school: user.orgUnitPath,
  })

  /**
   * Group membership overrides the org unit, and costs one call per person.
   *
   * It does not override the domain. A pupil placed in a staff group — by
   * mistake, or by someone who could — stays a pupil here, because their
   * address is what the school's own structure says they are and a group is
   * not a promotion. Without this, adding a child to the wrong mailing list
   * would grant them a staff role.
   */
  const withGroupRole = async (person: Person): Promise<Person> => {
    if (!roles.groups || Object.keys(roles.groups).length === 0) return person

    const domain = person.email.slice(person.email.lastIndexOf('@') + 1)
    if (domain === domains.students || domain === domains.parents) return person

    const body = await api.call<{ groups?: { email?: string }[] }>(
      `${DIRECTORY}/groups?userKey=${encodeURIComponent(person.email)}`,
    )

    for (const group of body.groups ?? []) {
      const mapped = group.email ? roles.groups[group.email.toLowerCase()] : undefined
      if (mapped) return { ...person, role: mapped }
    }

    return person
  }

  return {
    capabilities: {
      audit: true,
      calendar: Boolean(options.calendarId),
      // Workspace is not this school's website.
      content: false,
      groups: true,
      documents: Boolean(options.documentsFolderId),
      people: true,
      peopleWritable: options.writablePeople === true,
      rosters: options.classroom === true,
      // The thing this package adds. Declared absent rather than answered empty.
      selections: false,
    },

    countAccessChanges: async () => {
      const activities = await api.listAll<AuditActivity>(
        `${REPORTS}/activity/users/all/applications/admin`,
        { maxResults: 1000 },
        (page) => page.items as AuditActivity[] | undefined,
      )
      return activities.length
    },

    findPersonByEmail: async (email) => {
      const key = email.trim().toLowerCase()
      try {
        const user = await api.call<DirectoryUser>(
          `${DIRECTORY}/users/${encodeURIComponent(key)}`,
        )
        return await withGroupRole(toPerson(user))
      } catch (error) {
        // A person who is not there is not an error the caller must handle.
        if ((error as { status?: number }).status === 404) return undefined
        throw error
      }
    },

    listAccessChanges: async ({ limit = 20, subject } = {}) => {
      const activities = await api.listAll<AuditActivity>(
        `${REPORTS}/activity/users/all/applications/admin`,
        { maxResults: Math.min(limit, 1000) },
        (page) => page.items as AuditActivity[] | undefined,
      )

      const changes = activities.map((activity): AccessChange => {
        const event = activity.events?.[0]
        const parameter = (name: string) =>
          event?.parameters?.find((entry) => entry.name === name)?.value

        return {
          action: event?.name,
          actor: activity.actor?.email,
          at: activity.id?.time,
          // Workspace records that a change happened and by whom. It has no
          // field for *why*, which art. 5(2) asks for — so this is null rather
          // than filled with something that reads like a reason.
          reason: null,
          subject: parameter('USER_EMAIL') ?? parameter('user_email'),
        }
      })

      const filtered = subject
        ? changes.filter((change) => change.subject?.toLowerCase() === subject.toLowerCase())
        : changes

      return filtered.slice(0, limit)
    },

    // async, so an absent capability REJECTS rather than throwing
    // synchronously: the port promises a Promise, and a caller using
    // Promise.all would otherwise fail before its other reads had started.
    listCalendar: async ({ from, until } = {}) => {
      const calendarId = options.calendarId
      if (!calendarId) throw new UnsupportedCapability('calendar', 'Google Workspace')

      const events = await api.listAll<{
        end?: { date?: string; dateTime?: string }
        id?: string
        start?: { date?: string; dateTime?: string }
        summary?: string
      }>(
        `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          maxResults: 250,
          orderBy: 'startTime',
          // Recurring term dates expand into the instances a school keeps.
          singleEvents: 'true',
          ...(from ? { timeMin: from } : {}),
          ...(until ? { timeMax: until } : {}),
        },
        (page) => page.items as { id?: string; summary?: string }[] | undefined,
      )

      return events.map(
        (event): SchoolDate => ({
          // An all-day term boundary carries `date`; a timed one `dateTime`.
          allDay: Boolean(event.start?.date),
          ...(event.end?.dateTime ?? event.end?.date
            ? { ends: event.end.dateTime ?? event.end.date! }
            : {}),
          id: event.id ?? '',
          ...(event.start?.dateTime ?? event.start?.date
            ? { starts: event.start.dateTime ?? event.start.date! }
            : {}),
          title: bounded(event.summary),
        }),
      )
    },

    /**
     * The courses this domain runs, as classes.
     *
     * ACTIVE only. An archived course still answers to the API and is not this
     * year's class; a draw over last year's 12a would select a pupil who has
     * left, and a roll count that included it would overstate the school.
     */
    listClasses: async (): Promise<SchoolClass[]> => {
      if (options.classroom !== true) throw new UnsupportedCapability('rosters', 'Google Workspace')

      const courses = await api.listAll<Course>(
        `${CLASSROOM}/courses`,
        { courseStates: 'ACTIVE', pageSize: 100 },
        (page) => page.courses as Course[] | undefined,
      )

      return courses.map(
        (course): SchoolClass => ({
          ...(course.courseGroupEmail ? { group: course.courseGroupEmail } : {}),
          id: course.id ?? '',
          // Two year-nines are told apart by their section, not their name.
          name: bounded([course.name, course.section].filter(Boolean).join(' · ')) || (course.id ?? ''),
          state: course.courseState ?? 'ACTIVE',
        }),
      )
    },

    /**
     * One course's roster, as handles.
     *
     * Two calls, because Classroom keeps pupils and teachers in separate
     * collections, and both are paged to exhaustion for the usual reason: a
     * draw over a roster missing its last page is a draw a pupil cannot win.
     *
     * The course is fetched rather than taken from the caller's word for it,
     * so a roster answers with the name Classroom holds — and so a course id
     * that does not belong to this domain fails here, on Google's own
     * authorisation, rather than returning an empty roster that reads like a
     * class with nobody in it.
     */
    listRoster: async (classId: string): Promise<ClassRoster> => {
      if (options.classroom !== true) throw new UnsupportedCapability('rosters', 'Google Workspace')

      const id = encodeURIComponent(classId)

      const [course, students, teachers] = await Promise.all([
        api.call<Course>(`${CLASSROOM}/courses/${id}`),
        api.listAll<CourseMember>(
          `${CLASSROOM}/courses/${id}/students`,
          { pageSize: 100 },
          (page) => page.students as CourseMember[] | undefined,
        ),
        api.listAll<CourseMember>(
          `${CLASSROOM}/courses/${id}/teachers`,
          { pageSize: 100 },
          (page) => page.teachers as CourseMember[] | undefined,
        ),
      ])

      return sealRoster(
        {
          ...(course.courseGroupEmail ? { group: course.courseGroupEmail } : {}),
          id: course.id ?? classId,
          name: [course.name, course.section].filter(Boolean).join(' · ') || classId,
          state: course.courseState ?? '',
        },
        [
          // `userId` and nothing else. The profile block Classroom would
          // return under a wider scope is not read even where a school granted
          // one, so the minimisation does not depend on the consent screen.
          ...students.map((student) => ({ id: student.userId ?? '', role: 'student' as const })),
          ...teachers.map((teacher) => ({ id: teacher.userId ?? '', role: 'teacher' as const })),
        ],
      )
    },

    listCheckpoints: async (): Promise<SealedCheckpoint[]> => {
      throw new UnsupportedCapability('selections', 'Google Workspace')
    },

    listDocuments: async () => {
      const folder = options.documentsFolderId
      if (!folder) throw new UnsupportedCapability('documents', 'Google Workspace')

      const files = await api.listAll<DriveFile>(
        `${DRIVE}/files`,
        {
          fields: 'nextPageToken,files(id,name,webViewLink,mimeType,trashed)',
          pageSize: 100,
          q: `'${folder}' in parents and trashed = false`,
        },
        (page) => page.files as DriveFile[] | undefined,
      )

      return files.map(
        (file): SchoolDocument => ({
          id: file.id ?? '',
          // A Drive file in the folder IS the published artefact, so unlike a
          // CMS row it is reachable by existing — provided it has a link.
          reachable: Boolean(file.webViewLink),
          title: bounded(file.name),
          url: file.webViewLink ?? null,
        }),
      )
    },

    listGroups: async () => {
      const groups = await api.listAll<{ directMembersCount?: string; email?: string; id?: string; name?: string }>(
        `${DIRECTORY}/groups`,
        { domain: domains.base, maxResults: 200 },
        (page) => page.groups as { email?: string }[] | undefined,
      )

      return groups.map(
        (group): SchoolGroup => ({
          email: group.email ?? '',
          id: group.id ?? group.email ?? '',
          ...(group.directMembersCount ? { members: Number(group.directMembersCount) } : {}),
          name: group.name ?? group.email ?? '',
        }),
      )
    },

    listPeople: async () => {
      const users = await api.listAll<DirectoryUser>(
        `${DIRECTORY}/users`,
        { domain: domains.base, maxResults: 500 },
        (page) => page.users as DirectoryUser[] | undefined,
      )

      const people = users.map(toPerson)
      if (!roles.groups) return people
      return Promise.all(people.map(withGroupRole))
    },

    listSelections: async (): Promise<SelectionRecord[]> => {
      // Workspace holds no receipt chain. Answering [] would let the fairness
      // audit report an intact chain of nothing.
      throw new UnsupportedCapability('selections', 'Google Workspace')
    },

    recordDocument: async () => {
      throw new UnsupportedCapability('documents', 'Google Workspace (read-only)')
    },

    schoolRef: async () => ({ id: domains.base }),

    setRole: async (email, role, reason) => {
      if (options.writablePeople !== true) {
        throw new UnsupportedCapability('peopleWritable', 'Google Workspace')
      }

      // Directory has no field for why. The reason belongs in this package's
      // own append-only log; it is required here so no caller can change a
      // role through the Workspace path without stating one.
      if (reason.trim().length < 8) {
        throw new Error('A reason of at least 8 characters is required to change a role')
      }

      const unit = Object.entries(options.roles.orgUnits ?? {}).find(([, value]) => value === role)
      if (!unit) {
        throw new Error(
          `No org unit is mapped to the role "${role}", so this package cannot grant it without inventing where the school keeps that role.`,
        )
      }

      const before = await api.call<DirectoryUser>(
        `${DIRECTORY}/users/${encodeURIComponent(email.trim().toLowerCase())}`,
      )

      const transport = options.fetch ?? globalThis.fetch
      const response = await transport(
        `${DIRECTORY}/users/${encodeURIComponent(email.trim().toLowerCase())}`,
        {
          body: JSON.stringify({ orgUnitPath: unit[0] }),
          headers: {
            authorization: `Bearer ${await options.token()}`,
            'content-type': 'application/json',
          },
          method: 'PUT',
        },
      )

      if (!response.ok) {
        throw new Error(`Google API ${response.status} changing the role of ${email}`)
      }

      return { before: roleOf(before), id: before.id ?? email }
    },
  }
}
