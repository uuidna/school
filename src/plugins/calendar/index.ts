import type { CollectionConfig, Plugin } from 'payload'

import { withCollections } from '../collections.js'
import { isAdminOrRegistrar, isAuthenticated } from '../../access/roles.js'
import { describe } from '../../i18n/admin.js'
import { tenantField } from '../fair/index.js'

/**
 * The school year, for a school that keeps it itself.
 *
 * `payloadSource.listCalendar` read this collection before anything shipped
 * it — the precise failure this package was written against, reintroduced by
 * me. A self-hosted school would have got a runtime error from a capability
 * the sovereignty test reported as available, because that test compares what
 * sources *declare* and not whether the declaration is backed by anything.
 *
 * Term boundaries, closures and deadlines. Small on purpose: a school that
 * wants a full calendar has one, and this is what the compliance and financing
 * answers need to place a date in a school year.
 */

export type CalendarPluginOptions = {
  multiTenant?: boolean
  tenantsSlug?: string
}

export const schoolCalendar = (options: CalendarPluginOptions = {}): CollectionConfig => ({
  slug: 'school-calendar',
  /**
   * Term dates are read by anyone the school has signed in, and written by
   * the office. With no rules declared, a pupil could delete the school year.
   */
  access: {
    create: isAdminOrRegistrar,
    delete: isAdminOrRegistrar,
    read: isAuthenticated,
    update: isAdminOrRegistrar,
  },
  admin: { defaultColumns: ['title', 'starts', 'ends'], useAsTitle: 'title' },
  fields: [
    ...tenantField(options),
    { name: 'title', type: 'text', required: true },
    { name: 'starts', type: 'date', index: true, required: true },
    { name: 'ends', type: 'date' },
    {
      name: 'allDay',
      type: 'checkbox',
      admin: { description: describe('calendarAllDay') },
      defaultValue: true,
    },
  ],
})

export const calendarPlugin =
  (options: CalendarPluginOptions = {}): Plugin =>
  (config) => ({
    ...config,
    collections: withCollections(config, [schoolCalendar(options)]),
  })
