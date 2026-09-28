/**
 * The school's system of record — whatever it already is.
 *
 * `@uuidna/school` extends a school; it does not replace one. A school that
 * runs on Google Workspace keeps its people in Directory and its documents in
 * Drive, and nothing here asks it to copy them into a second database. Copying
 * would be the worst available answer anyway: duplicating minors' records to
 * audit them is the opposite of art. 5(1)(c).
 *
 * So the tools read through this port, and a source implements what its system
 * actually has. The operations below were derived from what the thirteen tools
 * already do — not designed in advance — which is why there are five groups and
 * not more.
 *
 * What a source is NOT required to provide is the interesting part. Google
 * Workspace has people, documents and an administrative audit trail. It has no
 * notion of a draw nobody can rig, a receipt chain, or a statutory publication
 * list — those are what this package adds on top. A source declares what it can
 * do; tools whose capability is absent are not offered to the caller, the same
 * way a tool the caller's role forbids is not offered.
 */

/** Mirrors SchoolRole. `parent` is derived from addressing, never granted. */
/**
 * Supplies a bearer token per request.
 *
 * Defined here rather than in each transport: Google and Microsoft want the
 * same thing, and two identical types under one name is how an import starts
 * meaning whichever module was reached first.
 *
 * A function rather than a string so a short-lived token refreshes without
 * rebuilding the source, and so a long-lived secret is never held in a field
 * that ends up in a log line.
 */
export type TokenSource = () => Promise<string> | string

export type SchoolRoleName = 'admin' | 'parent' | 'registrar' | 'student' | 'teacher'

export type Person = {
  /** The class this person belongs to, for a pupil or parent. */
  class?: string
  email: string
  id: number | string
  name?: string
  role?: SchoolRoleName
  /** Org unit, tenant, or whatever the source calls the school this person is in. */
  school?: string
}

/**
 * Every field a synced person carries, as a value the schema check can read.
 *
 * A TYPE CANNOT BE ASKED AT RUNTIME, which is why this exists and why it is
 * bound to the type rather than typed out beside it. The host's collection has
 * to have somewhere to put each of these or the value is dropped on sync —
 * silently, because a source that returns more than a collection stores looks
 * exactly like a source that returned less. This package has already shipped
 * that bug once: `payloadSource.toPerson` dropped `class` while Workspace and
 * M365 both carried it, and every test passed.
 *
 * `id` is not here: Payload supplies it, and no host is asked to make room.
 */
export const SYNCED_PERSON_FIELDS = ['class', 'email', 'name', 'role', 'school'] as const

export type SyncedPersonField = (typeof SYNCED_PERSON_FIELDS)[number]

/**
 * The two cannot drift. Adding a field to `Person` without adding it here is a
 * COMPILE error, not a gap discovered later by a school missing data — which
 * is the whole point of writing the list twice in a way that refuses to be
 * written twice differently.
 */
type PersonFieldsAgree =
  Exclude<keyof Person, 'id'> extends SyncedPersonField
    ? SyncedPersonField extends Exclude<keyof Person, 'id'>
      ? true
      : ['SYNCED_PERSON_FIELDS names a field Person does not have']
    : ['Person has a field SYNCED_PERSON_FIELDS does not name — add it, or a sync will drop it']

const _personFieldsAgree: PersonFieldsAgree = true
void _personFieldsAgree

export type SchoolDocument = {
  category?: string
  id: number | string
  legalBasis?: string
  /** Set when the document can actually be obtained, not merely recorded. */
  reachable: boolean
  title: string
  url?: null | string
}

export type AccessChange = {
  action?: string
  actor?: string
  at?: string
  /** Why the right was given. art. 5(2) asks for the reason, not just the fact. */
  reason?: null | string
  subject?: string
}

export type SelectionRecord = {
  chainHash?: null | string
  id: number | string
  prevHash?: null | string
  receipt?: unknown
  /**
   * Position in the school's chain, contiguous from 1 — not the row's id.
   *
   * A source answering this port has to preserve the numbering it was given,
   * because the number is hashed into the link: renumbering a trail on import
   * does not renumber the receipts, it invalidates them. Optional because a
   * record may arrive without one, which `verifyChain` then reports as a gap
   * rather than silently filling in.
   */
  seq?: null | number
}

/** A seal as the source stores it. `fair/chain.ts` has its own `Checkpoint`:
 *  that one is what a chain is *measured against*, this is the stored row. */
export type SealedCheckpoint = {
  chainLength?: number
  leafCount?: number
  root?: string
  sealedAt?: string
}

/**
 * What this source can answer. Declared rather than discovered by failure: a
 * tool offered and then refused teaches a client nothing it can act on.
 */
export type SourceCapabilities = {
  /** Read the administrative audit trail. */
  audit: boolean
  /** Read the school's own calendar — term dates, deadlines, closures. */
  calendar: boolean
  /** Read the groups the school organises itself by. */
  groups: boolean
  /** Read and record the statutory document typology. */
  documents: boolean
  /** Read people and, where writable, change what they may do. */
  people: boolean
  /** Read the classes the school teaches, and who is in them. */
  rosters: boolean
  /** Change a person's role. False for a source that is read-only on identity. */
  peopleWritable: boolean
  /** Read the provably fair selection trail. Absent from every system that is
   *  not this one — it is the thing being added. */
  selections: boolean
  /** Publish pages and posts. A school whose site is elsewhere says false. */
  content: boolean
}

/** A date in the school's year: a term boundary, a closure, a deadline. */
export type SchoolDate = {
  allDay: boolean
  /** ISO. Absent on an event the source published without one. */
  ends?: string
  id: string
  starts?: string
  title: string
}

/** A group the school organises itself by — a class, a department, a role. */
export type SchoolGroup = {
  /** Its address, which for a class group is what a draw runs over. */
  email: string
  id: string
  members?: number
  name: string
}

/**
 * A class the school teaches.
 *
 * Counts, never members. "How big is 12a" is a question about a school; "who
 * is in 12a" is a question about children, and the two are answered by
 * different methods on purpose so that the first cannot accidentally answer
 * the second.
 */
export type SchoolClass = {
  /** The class group address, where the source has one — what a draw runs over. */
  group?: string
  id: string
  name: string
  /** As the source states it. An archived course is not this year's class. */
  state?: string
  students?: number
  teachers?: number
}

/**
 * One person in a class, as a pseudonym.
 *
 * The port carries no name and no address here, and that is not a setting.
 * A draw needs identifiers it can commit to and place in order; it does not
 * need identities, and art. 5(1)(c) makes the difference the deciding one.
 * The handle is stable, so a receipt stays verifiable, and scoped to its
 * class, so two rosters cannot be joined into a picture of a child's timetable.
 */
export type RosterMember = {
  handle: string
  role: 'student' | 'teacher'
}

export type ClassRoster = {
  class: SchoolClass
  /** In handle order, so the commitment does not depend on who enrolled first. */
  members: RosterMember[]
  /** Commitment over the pupils — the value a draw across this class carries. */
  rosterHash: string
}

export type SchoolSource = {
  capabilities: SourceCapabilities

  countAccessChanges(): Promise<number>
  listAccessChanges(options?: { limit?: number; subject?: string }): Promise<AccessChange[]>

  listCalendar(options?: { from?: string; until?: string }): Promise<SchoolDate[]>
  listClasses(): Promise<SchoolClass[]>
  /** The pseudonymous roster of one class, sealed with its commitment. */
  listRoster(classId: string): Promise<ClassRoster>
  listCheckpoints(): Promise<SealedCheckpoint[]>
  listGroups(): Promise<SchoolGroup[]>
  listDocuments(): Promise<SchoolDocument[]>
  listPeople(): Promise<Person[]>
  listSelections(): Promise<SelectionRecord[]>

  findPersonByEmail(email: string): Promise<Person | undefined>

  /** The school this request is for, as the source names it. */
  schoolRef(): Promise<null | { id: number | string; jurisdiction?: string }>

  recordDocument(document: {
    category?: string
    legalBasis: string
    link?: string
    note?: string
    title: string
  }): Promise<{ action: 'created' | 'updated'; id: number | string }>

  setRole(email: string, role: SchoolRoleName, reason: string): Promise<{ before?: string; id: number | string }>
}

/** A source that cannot do something says so, once, in the same shape. */
export class UnsupportedCapability extends Error {
  constructor(capability: keyof SourceCapabilities, source: string) {
    super(`${source} does not provide "${capability}", so this tool is not available on this school's system.`)
    this.name = 'UnsupportedCapability'
  }
}
