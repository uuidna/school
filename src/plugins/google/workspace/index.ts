import { describe } from '../../../i18n/admin.js'

import type { Config, Field, Plugin } from 'payload'

import type { WorkspaceRoleMapping } from '../../../sources/google/workspace.js'

import { domainsFor } from '../../../sources/google/identity.js'

/**
 * Google Workspace, as a plugin.
 *
 * It adds no collection of people and no collection of documents, and that
 * absence is the design. The school's people are in Directory and its files
 * are in Drive; this package reads them where they live. A plugin that created
 * `students` here would be replacing the school's system instead of extending
 * it, and would duplicate minors' records to audit them — the opposite of what
 * art. 5(1)(c) allows.
 *
 * What it does add is where a school states its own Workspace: the primary
 * domain, the Drive folder holding the statutory acts, and how staff roles are
 * decided. Those belong to the school, not to the deployment, so they live on
 * the tenant record — one instance can serve two schools with different
 * domains, different folders and different role structures.
 */

export type WorkspacePluginOptions = {
  /** Set false on an instance that serves exactly one school. */
  multiTenant?: boolean
  /**
   * Fallback role mapping for a school that states none of its own.
   *
   * Deliberately has no default. Every staff member shares the primary domain,
   * so an address separates staff from pupils and cannot separate a registrar
   * from a teacher; a guessed mapping hands somebody a role the school never
   * granted.
   */
  roles?: WorkspaceRoleMapping
  tenantsSlug?: string
}

/** The fields a school fills in to point this package at its own Workspace. */
export const workspaceFields = (): Field[] => [
  {
    name: 'googleWorkspace',
    type: 'group',
    admin: {
      description: describe('workspaceGroup'),
    },
    fields: [
      {
        name: 'domain',
        type: 'text',
        admin: {
          description: describe('workspaceDomain'),
        },
      },
      {
        name: 'documentsFolderId',
        type: 'text',
        admin: { description: describe('documentsFolder') },
      },
      {
        name: 'calendarId',
        type: 'text',
        admin: { description: describe('calendarSource') },
      },
      {
        name: 'classroom',
        type: 'checkbox',
        admin: { description: describe('classRosters') },
        defaultValue: false,
      },
      {
        name: 'roleGroups',
        type: 'array',
        admin: {
          description: describe('roleGroups'),
        },
        fields: [
          { name: 'group', type: 'text', required: true },
          {
            name: 'role',
            type: 'select',
            options: ['admin', 'registrar', 'teacher'],
            required: true,
          },
        ],
      },
      {
        name: 'writable',
        type: 'checkbox',
        admin: {
          description: describe('writableDirectory'),
        },
        defaultValue: false,
      },
    ],
  },
]

/** Reads a tenant's stated Workspace configuration, or nothing. */
export const workspaceConfigOf = (
  tenant: unknown,
): null | {
  calendarId?: string
  classroom: boolean
  documentsFolderId?: string
  domains: ReturnType<typeof domainsFor>
  roles: WorkspaceRoleMapping
  writable: boolean
} => {
  const stated = (tenant as { googleWorkspace?: Record<string, unknown> } | null)?.googleWorkspace
  const domain = typeof stated?.domain === 'string' ? stated.domain.trim() : ''

  if (!domain) return null

  const groups: Record<string, 'admin' | 'registrar' | 'teacher'> = {}
  for (const entry of (stated?.roleGroups ?? []) as { group?: string; role?: string }[]) {
    if (entry.group && entry.role) {
      groups[entry.group.toLowerCase()] = entry.role as 'admin' | 'registrar' | 'teacher'
    }
  }

  return {
    ...(typeof stated?.calendarId === 'string' && stated.calendarId
      ? { calendarId: stated.calendarId }
      : {}),
    classroom: stated?.classroom === true,
    ...(typeof stated?.documentsFolderId === 'string' && stated.documentsFolderId
      ? { documentsFolderId: stated.documentsFolderId }
      : {}),
    domains: domainsFor(domain),
    roles: { groups },
    writable: stated?.writable === true,
  }
}

/** Adds the Workspace configuration to each school's record. */
export const googleWorkspacePlugin =
  (options: WorkspacePluginOptions = {}): Plugin =>
  (config: Config): Config => {
    const tenantsSlug = options.tenantsSlug ?? 'tenants'

    return {
      ...config,
      collections: (config.collections ?? []).map((collection) =>
        collection.slug === tenantsSlug
          ? { ...collection, fields: [...collection.fields, ...workspaceFields()] }
          : collection,
      ),
    }
  }
