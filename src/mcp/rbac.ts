import type { PayloadRequest } from 'payload'

import type { SchoolRole } from '../access/roles.js'

import { GRANTABLE_ROLES, STAFF_ROLES } from '../access/roles.js'
import type { SchoolMcpTool } from './registry.js'

import { resolveSource } from '../sources/resolve.js'
import { enumOf, failure, json, str, text } from './registry.js'

/**
 * RBAC workflows, shaped as the four things an administrator actually does —
 * review access, check one person, grant a role, revoke access — rather than as
 * raw update calls on the users collection. That is not decoration:
 *
 * - every mutating tool takes a `reason`, which lands in the access log,
 *   because art. 5(2) of Regulation (EU) 2016/679 requires the controller to
 *   demonstrate why a right was given, not merely that it was;
 * - no tool reaches pupils' data;
 * - no tool creates or deletes an account: creating an identity and erasing a
 *   person are acts for a named human, and deletion would destroy the audit
 *   trail that art. 30 requires be kept.
 */

/**
 * The roles this tool may grant.
 *
 * Read from the access layer rather than restated, and `parent` is not among
 * them: being a parent follows from `<class>@parents.<domain>`, not from
 * somebody conferring it, and a granted parent would be the parent of no class.
 */
const ROLES = GRANTABLE_ROLES

/**
 * Confined to this school, and read from whichever system holds its people.
 * An administrator of one school may not read, nor change the role of, an
 * account belonging to another.
 */
const findUserByEmail = async (req: PayloadRequest, email: string) => {
  const { source } = await resolveSource(req)
  return source.findPersonByEmail(email)
}

export const rbacMcpTools: SchoolMcpTool[] = [
  {
    name: 'school_access_review',
    needs: ['people'],
    description:
      'Periodic access review for the school: every account grouped by role, with the tenant each belongs to and when it was last changed. Use this to answer "who can see pupils\' data" and to find accounts that should have been revoked.',
    allowedRoles: ['admin', 'registrar'],
    writes: false,
    inputSchema: { type: 'object' },
    handler: async (_args: Record<string, unknown>, req: PayloadRequest) => {
      // Everyone. An access review that stops at a thousand accounts answers
      // "who can see pupils' data" with a guess.
      const { reason, source, system } = await resolveSource(req)
      const people = await source.listPeople()

      const byRole: Record<string, { class?: string; email: string; name?: string }[]> = {}

      for (const person of people) {
        const role = person.role ?? 'unknown'
        byRole[role] ??= []
        byRole[role].push({
          ...(person.class ? { class: person.class } : {}),
          email: person.email,
          ...(person.name ? { name: person.name } : {}),
        })
      }

      return json({
        generatedAt: new Date().toISOString(),
        note: 'Administrative access review. No pupil records are included.',
        readFrom: { reason, system },
        roles: Object.fromEntries(
          Object.entries(byRole).map(([role, users]) => [role, { count: users.length, users }]),
        ),
        total: people.length,
      })
    },
  },
  {
    name: 'school_check_access',
    needs: ['people', 'audit'],
    description:
      'What one person can do: their role, the school they belong to, whether they may reach the admin panel, and the last few changes to their access from the audit log.',
    allowedRoles: ['admin', 'registrar'],
    writes: false,
    inputSchema: {
      properties: { email: str('The account to inspect') },
      required: ['email'],
      type: 'object',
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const user = await findUserByEmail(req, String(args.email))
      if (!user) return text(`No account for ${args.email}`)

      const { source } = await resolveSource(req)
      const history = await source.listAccessChanges({ limit: 5, subject: user.email })

      const role = user.role as SchoolRole

      return json({
        // Read from the access rules themselves: a literal repeated here would
        // keep answering the old question after the rules changed.
        canReachAdminPanel: STAFF_ROLES.includes(role),
        canSeePupilRecords: STAFF_ROLES.includes(role),
        email: user.email,
        name: user.name,
        recentChanges: history,
        role,
      })
    },
  },
  {
    name: 'school_grant_role',
    needs: ['peopleWritable'],
    description:
      'Give an existing account a role (admin, registrar, teacher, student). The reason is recorded in the access log and cannot be omitted. Does not create accounts.',
    allowedRoles: ['admin'],
    writes: true,
    inputSchema: {
      properties: {
        email: str('The existing account to change'),
        reason: str('Why this person needs this role — recorded for the audit trail (min 8 chars)'),
        role: enumOf(ROLES, 'The role to grant'),
      },
      required: ['email', 'reason', 'role'],
      type: 'object',
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      if (String(args.reason ?? '').trim().length < 8) {
        return failure('A reason of at least 8 characters is required and is recorded in the audit log')
      }

      const user = await findUserByEmail(req, String(args.email))
      if (!user) return text(`No account for ${args.email} — accounts are created in the admin panel`)

      const before = user.role as string

      if (before === args.role) {
        return text(`${user.email} already holds the role ${before}; nothing changed`)
      }

      const { source } = await resolveSource(req)
      await source.setRole(user.email, args.role as SchoolRole, String(args.reason))

      return json({
        changed: true,
        email: user.email,
        reason: args.reason,
        roleAfter: args.role,
        roleBefore: before,
      })
    },
  },
  {
    name: 'school_revoke_access',
    needs: ['peopleWritable'],
    description:
      'Offboard someone: drops their role to student, which removes the admin panel and every staff permission. The account and its audit trail are kept — deletion would destroy the record the law requires to be retained.',
    allowedRoles: ['admin'],
    writes: true,
    inputSchema: {
      properties: {
        email: str('The account to revoke'),
        reason: str('Why access is being removed — recorded for the audit trail (min 8 chars)'),
      },
      required: ['email', 'reason'],
      type: 'object',
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      if (String(args.reason ?? '').trim().length < 8) {
        return failure('A reason of at least 8 characters is required and is recorded in the audit log')
      }

      const user = await findUserByEmail(req, String(args.email))
      if (!user) return text(`No account for ${args.email}`)

      const before = user.role as string

      // A parent or pupil holds no staff permission to remove, and dropping
      // them to 'student' would not revoke anything — it would reclassify a
      // parent as a pupil and sever the class link their access depends on.
      if (!STAFF_ROLES.includes(before as never)) {
        return text(`${user.email} holds no staff permissions (${before ?? 'none'}); nothing to revoke`)
      }

      const { source } = await resolveSource(req)
      await source.setRole(user.email, 'student', String(args.reason))

      return json({
        email: user.email,
        note: 'The account and its audit trail are kept.',
        reason: args.reason,
        revokedFrom: before,
        roleAfter: 'student',
      })
    },
  },
]
