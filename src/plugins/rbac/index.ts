import { describe } from '../../i18n/admin.js'

import type { CollectionBeforeChangeHook, Plugin } from 'payload'


/**
 * The access log, and the hook that actually writes it.
 *
 * The audit found this claim unbacked: the README said a reason "lands in an
 * append-only log written by a hook, so a change made through the admin panel,
 * the REST API, MCP or a script is recorded identically" — and `accessReason`
 * had two producers and no consumer at all. Every reason a registrar typed was
 * discarded. art. 5(2) asks the controller to demonstrate why a right was
 * given; the package asked for the why and then dropped it.
 *
 * Writing it in a hook rather than in the MCP tool is the part that matters.
 * A role changed through the admin panel is recorded the same as one changed
 * over MCP, because neither goes round the hook — which is exactly what makes
 * the log evidence rather than a convention.
 */

export type RbacPluginOptions = {
  multiTenant?: boolean
  tenantsSlug?: string
  /** Slug of the collection holding accounts. */
  usersSlug?: string
}

/** What a change to someone's access is recorded as. */
/**
 * Records a change of role, with the reason the caller stated.
 *
 * A change with no reason is still recorded — as a change with no reason.
 * Silently dropping it would hide the one thing an inspection looks for, and
 * `school_data_protection_report` counts these under
 * `changesWithoutStatedReason`.
 */
/**
 * Carries the stated reason and the acting user onto the document, so the
 * version Payload is about to write contains them.
 *
 * BEFORE, NOT AFTER. The old hook ran afterChange and wrote a row elsewhere;
 * this runs beforeChange and writes onto the document being saved, which is the
 * only moment the snapshot can still be affected. A version is immutable once
 * written — that is why it makes a good audit trail, and why the reason has to
 * arrive before it.
 *
 * A CHANGE WITH NO REASON IS STILL RECORDED, as a change with no reason.
 * Refusing it would hide the one thing an inspection looks for; the tools that
 * grant and revoke demand a reason of their own, so a change arriving without
 * one came from somewhere else, and that is exactly what wants seeing.
 */
export const stampAccessChange: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (operation !== 'update') return data
  const before = (originalDoc as { role?: unknown } | undefined)?.role
  const after = (data as { role?: unknown }).role
  // Only a role change is an access change. Every other edit makes a version
  // and leaves these two fields exactly as they were.
  if (after === undefined || after === before) return data

  const reason = (req.context as { accessReason?: unknown } | undefined)?.accessReason

  return {
    ...data,
    accessChangedBy: req.user ? ((req.user as { email?: string }).email ?? String(req.user.id)) : 'system',
    accessReason: typeof reason === 'string' ? reason : null,
  }
}

export const rbacPlugin =
  (options: RbacPluginOptions = {}): Plugin =>
  (config) => {
    const usersSlug = options.usersSlug ?? 'users'

    return {
      ...config,
      /**
       * THE TRAIL IS THE VERSION HISTORY NOW, so there is no collection here.
       *
       * `access-log` held eight fields and six restated a document Payload
       * already versions: `before` and `after` are two adjacent versions,
       * `subject` is the user's own email, `summary` is those in a sentence,
       * `at` is the version's timestamp. A second account of one event, free to
       * disagree with the first, with append-only enforced by an access rule
       * where Payload's version store is immutable by construction.
       *
       * What a version does NOT record is who changed it and why — and art.
       * 5(2) of Regulation (EU) 2016/679 asks the controller to demonstrate the
       * WHY. So those two travel on the user document, which is what puts them
       * inside the snapshot. The fields are added here; the reading back is
       * accessChangesFromVersions.
       */
      collections: (config.collections ?? []).map((collection) =>
        collection.slug === usersSlug
          ? {
              ...collection,
              fields: [
                ...(collection.fields ?? []),
                {
                  admin: { description: describe('auditReason'), readOnly: true },
                  name: 'accessReason',
                  type: 'textarea' as const,
                },
                {
                  admin: { description: describe('auditActor'), readOnly: true },
                  name: 'accessChangedBy',
                  type: 'text' as const,
                },
              ],
              hooks: {
                ...collection.hooks,
                beforeChange: [
                  ...(collection.hooks?.beforeChange ?? []),
                  stampAccessChange,
                ],
              },
              /**
               * UNLIMITED, because Payload keeps 100 per document by default
               * and this history is the audit trail. A head teacher's account
               * crossing a hundred edits — a name, a photograph, a class —
               * drops the oldest, and the oldest is where the grant that
               * matters usually is. assertSchema refuses anything else.
               */
              versions: { maxPerDoc: 0 },
            }
          : collection,
      ),
    }
  }
