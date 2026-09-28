import type { Config, Field, Plugin } from 'payload'

import type { M365RoleMapping } from '../../../sources/microsoft/m365.js'

import { describe } from '../../../i18n/admin.js'

/**
 * Microsoft 365, as a plugin.
 *
 * The adapter it configures has existed for some time and could not be
 * reached: `resolveSource` knew about Google and about this package's own
 * store, so a school on Microsoft was answered from an empty Payload while a
 * complete Graph adapter sat beside it, tested, exported and unreachable. The
 * sovereignty test did not catch it, because it compares what the adapters can
 * do and never asks whether a school can choose one — the same shape as a
 * collection nothing ships.
 *
 * Like the Workspace plugin, it adds no collection of people and no collection
 * of documents. The school's people are in Entra ID and its files are in
 * SharePoint, and a `students` collection here would be a second copy of
 * minors' records kept in order to report on them.
 *
 * The fields mirror the Workspace ones deliberately, down to their help text
 * where the field means the same thing. A school moving between the two should
 * be filling in the same form.
 */

export type M365PluginOptions = {
  /** Set false on an instance that serves exactly one school. */
  multiTenant?: boolean
  /** Fallback role mapping for a school that states none of its own. */
  roles?: M365RoleMapping
  tenantsSlug?: string
}

/** The fields a school fills in to point this package at its own Microsoft 365. */
export const m365Fields = (): Field[] => [
  {
    name: 'microsoft365',
    type: 'group',
    admin: { description: describe('microsoftGroup') },
    fields: [
      {
        name: 'domain',
        type: 'text',
        admin: { description: describe('workspaceDomain') },
      },
      {
        name: 'documentsDriveId',
        type: 'text',
        admin: { description: describe('documentsFolder') },
      },
      {
        name: 'calendarUser',
        type: 'text',
        admin: { description: describe('calendarSource') },
      },
      {
        name: 'education',
        type: 'checkbox',
        admin: { description: describe('classRosters') },
        defaultValue: false,
      },
      {
        name: 'roleGroups',
        type: 'array',
        admin: { description: describe('roleGroups') },
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
        admin: { description: describe('writableDirectory') },
        defaultValue: false,
      },
    ],
  },
]

/** Reads a tenant's stated Microsoft 365 configuration, or nothing. */
export const m365ConfigOf = (
  tenant: unknown,
): null | {
  calendarUser?: string
  documentsDriveId?: string
  domains: { base: string; parents: string; students: string }
  education: boolean
  roles: M365RoleMapping
  writable: boolean
} => {
  const stated = (tenant as { microsoft365?: Record<string, unknown> } | null)?.microsoft365
  const domain = typeof stated?.domain === 'string' ? stated.domain.trim().toLowerCase() : ''

  if (!domain) return null

  const groups: Record<string, 'admin' | 'registrar' | 'teacher'> = {}
  for (const entry of (stated?.roleGroups ?? []) as { group?: string; role?: string }[]) {
    if (entry.group && entry.role) {
      groups[entry.group.toLowerCase()] = entry.role as 'admin' | 'registrar' | 'teacher'
    }
  }

  return {
    ...(typeof stated?.calendarUser === 'string' && stated.calendarUser
      ? { calendarUser: stated.calendarUser }
      : {}),
    ...(typeof stated?.documentsDriveId === 'string' && stated.documentsDriveId
      ? { documentsDriveId: stated.documentsDriveId }
      : {}),
    // The same subdomain convention Workspace uses, because it is the school's
    // addressing and not Google's: a pupil is <class>@students.<domain>
    // wherever the mailbox happens to be hosted.
    domains: { base: domain, parents: `parents.${domain}`, students: `students.${domain}` },
    education: stated?.education === true,
    roles: { groups },
    writable: stated?.writable === true,
  }
}

/** Adds the Microsoft 365 configuration to each school's record. */
export const microsoft365Plugin =
  (options: M365PluginOptions = {}): Plugin =>
  (config: Config): Config => {
    const tenantsSlug = options.tenantsSlug ?? 'tenants'

    return {
      ...config,
      collections: (config.collections ?? []).map((collection) =>
        collection.slug === tenantsSlug
          ? { ...collection, fields: [...collection.fields, ...m365Fields()] }
          : collection,
      ),
    }
  }
