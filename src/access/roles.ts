import type { Access, FieldAccess, PayloadRequest } from 'payload'

/**
 * Roles used across the school registers.
 *
 * `req.user` is a union — the MCP plugin adds an API-key identity alongside the
 * human `User` — so role checks go through `roleOf`, which narrows before it
 * reads. An MCP key has no role and therefore passes no role gate.
 */
export type SchoolRole = 'admin' | 'parent' | 'registrar' | 'student' | 'teacher'

export const roleOf = (user: PayloadRequest['user']): SchoolRole | undefined =>
  user && 'role' in user ? ((user as { role?: SchoolRole }).role ?? undefined) : undefined

/**
 * The class a pupil or parent belongs to, as `<class>@students.<domain>`.
 *
 * A parent's whole authority is this one value, so a parent without it reaches
 * nothing — see `isOwnClass`. Read through a helper because "no class" and "a
 * class named empty string" must not become the same thing.
 */
export const classOf = (user: PayloadRequest['user']): string | undefined => {
  const stated = user && 'class' in user ? (user as { class?: unknown }).class : undefined
  return typeof stated === 'string' && stated.trim() ? stated.trim().toLowerCase() : undefined
}

/** Access gate for one or more roles. */
export const hasRole =
  (...roles: SchoolRole[]): Access =>
  ({ req }) => {
    const role = roleOf(req.user)
    return role !== undefined && roles.includes(role)
  }

/** Field-level gate: same rule, different signature than collection access. */
export const hasFieldRole =
  (...roles: SchoolRole[]): FieldAccess =>
  ({ req }) => {
    const role = roleOf(req.user)
    return role !== undefined && roles.includes(role)
  }

/**
 * Any signed-in identity, human or API key.
 *
 * Note for hosts: parents are signed-in identities. A collection gated on this
 * alone is readable by every parent in the school, which is almost never what
 * a collection about pupils wants — use `isOwnClass` or a staff gate.
 */
export const isAuthenticated: Access = ({ req }) => Boolean(req.user)

/** Open to the public — announcements and documents are published material. */
export const isAnyone: Access = () => true

export const isAdmin = hasRole('admin')
export const isAdminOrTeacher = hasRole('admin', 'teacher')
export const isAdminOrRegistrar = hasRole('admin', 'registrar')
export const canDraw = hasRole('admin', 'registrar', 'teacher')

/** Website content: admins and teachers write it, admins alone delete it. */
export const isEditor = hasRole('admin', 'teacher')

/**
 * The roles that reach the admin panel and, through it, pupils' records.
 *
 * Stated once. `school_check_access` reports this set to an inspector, so a
 * second copy of the list somewhere else is a compliance tool answering a
 * question the rules stopped asking.
 */
export const STAFF_ROLES: readonly SchoolRole[] = ['admin', 'registrar', 'teacher']

/**
 * Roles an administrator may grant.
 *
 * `parent` is deliberately absent. Being a parent is a fact about the school's
 * addressing — `<class>@parents.<domain>` — not a right somebody confers, and a
 * granted "parent" would be a parent of no class: an identity whose only
 * authority is a link it does not have. Granting it would either reach nothing
 * or, if a later rule were sloppier than `isOwnClass`, reach everything.
 */
export const GRANTABLE_ROLES: readonly SchoolRole[] = ['admin', 'registrar', 'student', 'teacher']

/** Roles whose reach is one class rather than the school. */
export const CLASS_SCOPED_ROLES: readonly SchoolRole[] = ['parent', 'student']

/**
 * Staff reach the admin panel; students use the public site and their portal.
 * `access.admin` is a boolean gate — unlike the others it cannot return a query.
 */
export const canUseAdminPanel = ({ req }: { req: PayloadRequest }): boolean => {
  const role = roleOf(req.user)
  return role !== undefined && STAFF_ROLES.includes(role)
}

/**
 * A user may read and edit their own record; admins may touch any.
 * Returned as a query constraint rather than a boolean, so list views are
 * filtered by the database instead of by hiding rows after the fact.
 */
export const isSelfOrAdmin: Access = ({ req }) => {
  if (roleOf(req.user) === 'admin') return true
  if (!req.user) return false
  return { id: { equals: req.user.id } }
}

/**
 * Staff see the school; a parent or pupil sees one class.
 *
 * This is what the fairness section always promised and had no access rule for:
 * "inclusion proofs a parent can verify without being shown every other pupil's
 * draw." A query constraint rather than a boolean, so the database does the
 * narrowing and no row is fetched and then hidden.
 *
 * **Fails closed.** A parent whose class is unknown reaches nothing, rather
 * than falling through to an unconstrained read. That is the difference
 * between a filter and a hole: `{ class: { equals: undefined } }` is not a
 * restriction, and returning it would hand a parent every class in the school.
 *
 * `field` names the class column on the collection being gated, because a draw
 * and a notice do not have to store it under the same name.
 */
export const isOwnClass =
  (field = 'class'): Access =>
  ({ req }) => {
    const role = roleOf(req.user)
    if (role === undefined) return false
    if (STAFF_ROLES.includes(role)) return true
    if (!CLASS_SCOPED_ROLES.includes(role)) return false

    const own = classOf(req.user)
    if (!own) return false

    return { [field]: { equals: own } }
  }

/** A parent, confined to their own class. Nothing else on the surface. */
export const isParent = hasRole('parent')
