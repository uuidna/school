import { describe } from '../../i18n/admin.js'

import type { Field, Plugin } from 'payload'

import { tenantField } from '../fair/index.js'

/**
 * The one field a migration needs on the host's media library.
 *
 * `sourceUrl` is what makes re-running a migration safe: three hundred images
 * do not become six hundred on the second pass, because each is matched to
 * what it came from. Unique, so two rows cannot claim the same origin.
 *
 * It records an address. Nothing in this package opens it.
 */

export type MediaPluginOptions = {
  mediaSlug?: string
  multiTenant?: boolean
  tenantsSlug?: string
}

/**
 * What makes duplication impossible rather than unlikely.
 *
 * Keying on the source URL guarantees nothing: a CDN serves one file under
 * several addresses — `~mv2` suffixes, resize query strings — and a migration
 * keyed on the URL stores the same photograph five times. The hash is of the
 * bytes, so two files with identical content cannot both exist here, and the
 * unique index is what enforces it: not a check this package runs and could
 * skip, a constraint the database will not let past.
 */
/**
 * WHAT THIS COSTS A HOST'S SCHEMA: one column, which is two bound parameters.
 *
 * That is not bookkeeping on D1. A query there may bind 100 parameters, and
 * Payload's update is an upsert that passes the same row twice — once to
 * insert, once to `do update set` — so the usable width of a collection is
 * about fifty columns, not a hundred. An upload collection spends six columns
 * per image size: at five sizes a host sits at 47 columns and 94 parameters,
 * and this field takes it to 96. Harmless there, decisive two fields later,
 * and the error when it arrives says `too many SQL variables` and names
 * neither the field nor the limit.
 *
 * `verifySchema` counts it at boot from the adapter's own table and reports
 * the headroom, so a host learns before a write rather than after. The
 * arithmetic is stated there.
 */
export const contentHashField = (): Field => ({
  name: 'contentHash',
  type: 'text',
  admin: {
    description: describe('contentHash'),
    readOnly: true,
  },
  index: true,
  unique: true,
})

/**
 * Every address this file was found at.
 *
 * Plural because one file legitimately has several, and provenance is worth
 * keeping: it is how somebody later works out which page referred to what.
 * Recorded only — nothing in this package opens them.
 */
export const sourceUrlField = (): Field => ({
  name: 'sourceUrls',
  type: 'array',
  admin: {
    description: describe('sourceUrls'),
    readOnly: true,
  },
  fields: [{ name: 'url', type: 'text', required: true }],
})

/** Adds `sourceUrl` to the host's existing media collection. */
export const mediaPlugin =
  (options: MediaPluginOptions = {}): Plugin =>
  (config) => {
    const mediaSlug = options.mediaSlug ?? 'media'

    return {
      ...config,
      collections: (config.collections ?? []).map((collection) =>
        collection.slug === mediaSlug
          ? {
              ...collection,
              fields: [
                ...collection.fields,
                contentHashField(),
                sourceUrlField(),
                // Media belongs to a school like everything else here, unless
                // the host keeps one library for all of them.
                ...(collection.fields.some((f) => 'name' in f && f.name === 'tenant')
                  ? []
                  : tenantField(options)),
              ],
            }
          : collection,
      ),
    }
  }
