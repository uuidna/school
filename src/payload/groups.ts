import type { AdminKey } from '../i18n/admin.js'

import { describe } from '../i18n/admin.js'

/**
 * Where a school's collections sit in an admin sidebar.
 *
 * A panel with no groups is one flat list, and the order in it is the order
 * the collections were registered — so a teacher looking for „Страници" reads
 * past the search index, the export queue and the form submissions to find it.
 *
 * The five names are the school's own shape rather than Payload's: what the
 * school publishes, who it teaches, how a place in something scarce was drawn,
 * who administers the instance, and the machinery that belongs to none of
 * those. A sixth would be a claim that a school has another kind of thing in
 * it, which is a claim worth making deliberately.
 *
 * THE LABEL IS NOT WRITTEN HERE. It is `group` crossed with ray, out of the one
 * table that carries every phrase this panel shows, so a heading arrives in the
 * reader's language for the same reason a field's help does — and so the guard
 * that checks that table for holes checks these too. Written here, they would
 * have been two languages in a panel that serves seven.
 */
export type SidebarGroup = 'administration' | 'content' | 'draws' | 'school' | 'system'

export const SIDEBAR_GROUPS = ['administration', 'content', 'draws', 'school', 'system'] as const

/** `content` → `groupContent`, the key the table is written under. */
const keyOf = (group: SidebarGroup): AdminKey =>
  `group${group[0]!.toUpperCase()}${group.slice(1)}` as AdminKey

/** The heading a reader sees, in every ray. */
export const sidebarGroup = (group: SidebarGroup): Record<string, string> => describe(keyOf(group))
