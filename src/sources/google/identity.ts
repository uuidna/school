/**
 * Who a Google Workspace address says someone is.
 *
 * A school's Workspace addresses a **class**, with the audience as an optional
 * subdomain:
 *
 *   <class>@<domain>            staff
 *   <class>@students.<domain>   that class's pupils
 *   <class>@parents.<domain>    that class's parents
 *
 * Two things follow, and both are load-bearing.
 *
 * **The address is a claim, not a fact.** Deriving what someone may do from a
 * string anyone can type is privilege escalation with extra steps. `identify`
 * therefore accepts only a `VerifiedIdentity`, which cannot be written down —
 * it is produced solely by `verifiedFromIdToken`, from a Google ID token whose
 * `email_verified` is true and whose hosted domain matches this school. A raw
 * string will not typecheck, which is the only way this stays true after the
 * fourth person edits it.
 *
 * **The unit is the class, not the pupil.** No individual pupil is named by any
 * address here, which is the right shape for art. 5(1)(c): a draw is held
 * within a class, and that class's parents are exactly the audience entitled to
 * check it. A parent address resolves to one class — never to a named child and
 * never to the school at large — so an inclusion proof can be shown to the
 * people it concerns without exposing anybody else's.
 */

export type WorkspaceDomains = {
  /** The school's primary domain; staff live directly on it. */
  base: string
  parents: string
  students: string
}

/** The three domains a school's Workspace uses, from its primary domain. */
export const domainsFor = (base: string): WorkspaceDomains => {
  const normalised = base.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  return {
    base: normalised,
    parents: `parents.${normalised}`,
    students: `students.${normalised}`,
  }
}

declare const verified: unique symbol

/**
 * An address Google has vouched for. Unforgeable by construction: the brand
 * cannot be produced outside this module.
 */
export type VerifiedIdentity = {
  readonly [verified]: true
  email: string
  name?: string
}

/** The claims of a Google ID token, as far as this module cares. */
export type IdTokenClaims = {
  email?: unknown
  email_verified?: unknown
  hd?: unknown
  name?: unknown
}

const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1)

/**
 * Accepts a Google ID token's claims, or returns null.
 *
 * Rejects an unverified email outright. `hd` is checked when present — Google
 * sets it for Workspace accounts — but the domain match below is what actually
 * confines the identity, because `hd` is absent for consumer accounts and its
 * absence must not read as permission.
 */
export const verifiedFromIdToken = (
  claims: IdTokenClaims,
  domains: WorkspaceDomains,
): null | VerifiedIdentity => {
  if (claims.email_verified !== true) return null
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) return null

  const email = claims.email.trim().toLowerCase()
  const domain = domainOf(email)

  // An address with no local part names nobody, and must not reach identify()
  // as though the domain alone conferred a role.
  if (!email.slice(0, email.lastIndexOf('@'))) return null

  // Exactly one of the school's three domains. Not "ends with": students.x.bg
  // ends with x.bg, and so does students.x.bg.attacker.com.
  const known = [domains.base, domains.students, domains.parents]
  if (!known.includes(domain)) return null

  // When Google states a hosted domain it must be this school's.
  if (typeof claims.hd === 'string' && claims.hd.toLowerCase() !== domains.base) return null

  return {
    email,
    ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
  } as VerifiedIdentity
}

/**
 * A verified address, resolved to the class it addresses and the audience it
 * belongs to. `classId` is the local part; `classEmail` is that class's pupil
 * group, which is the scope a draw runs over.
 */
export type SchoolIdentity =
  | { classEmail: string; classId: string; email: string; kind: 'parent' }
  | { classEmail: string; classId: string; email: string; kind: 'student' }
  | { classId: string; email: string; kind: 'staff' }

/**
 * What this verified address is, within the school.
 *
 * Both pupil and parent addresses resolve to the same class group, which is
 * what lets a parent be shown the draw their class took part in and no other.
 */
export const identify = (
  identity: VerifiedIdentity,
  domains: WorkspaceDomains,
): null | SchoolIdentity => {
  const email = identity.email
  const at = email.lastIndexOf('@')
  const classId = email.slice(0, at)
  const domain = email.slice(at + 1)

  if (!classId) return null

  const classEmail = `${classId}@${domains.students}`

  // Subdomains first: the staff domain is a suffix of both.
  if (domain === domains.students) return { classEmail, classId, email, kind: 'student' }
  if (domain === domains.parents) return { classEmail, classId, email, kind: 'parent' }

  // No audience subdomain — staff, addressed on the primary domain.
  if (domain === domains.base) return { classId, email, kind: 'staff' }

  return null
}

/**
 * Whether this identity is entitled to see a draw held in that class.
 *
 * The single question the addressing scheme exists to answer, asked in one
 * place so no caller re-derives it from string surgery. A class's own pupils
 * and that class's parents qualify; staff reach draws through their role, not
 * through this.
 */
export const maySeeClassDraw = (identity: SchoolIdentity, classEmail: string): boolean =>
  (identity.kind === 'parent' || identity.kind === 'student') &&
  identity.classEmail === classEmail.trim().toLowerCase()
