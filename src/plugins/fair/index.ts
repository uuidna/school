import { withCollections } from '../collections.js'
import { describe } from '../../i18n/admin.js'

import type { CollectionConfig, Field, Plugin } from 'payload'

import { canDraw, isAuthenticated, isOwnClass } from '../../access/roles.js'
import { linkIntoChain } from '../../fair/chain.js'

/**
 * Provably fair selection, as a self-sufficient plugin.
 *
 * This exists because of a gap the audit found: the package documented that
 * `random-selections` "MUST carry a unique index on (tenant, seq)" and then
 * shipped no collection, leaving the guarantee resting on whether a host
 * remembered to add one. Without it, two draws that race read the same head,
 * both insert, and the chain forks silently — every verification afterwards
 * passing on the fork.
 *
 * A requirement nobody computes is a requirement nobody meets. So the schema
 * that makes the guarantee true now ships with the code that claims it, and
 * the hook that links each receipt is attached here rather than by instruction.
 */

/**
 * The tenant relationship, or nothing on a single-school instance.
 *
 * Both plugins built this inline and identically. Two copies of a field that
 * decides which school a row belongs to is two places to get it wrong.
 */
export const tenantField = (options: {
  multiTenant?: boolean
  tenantsSlug?: string
}): Field[] =>
  options.multiTenant === false
    ? []
    : [
        {
          name: 'tenant',
          type: 'relationship',
          index: true,
          relationTo: options.tenantsSlug ?? 'tenants',
          required: true,
        },
      ]

export type FairPluginOptions = {
  /** Slug of the tenants collection, when the host names it differently. */
  tenantsSlug?: string
  /** Set false on an instance that serves exactly one school. */
  multiTenant?: boolean
}

const selections = (options: FairPluginOptions): CollectionConfig => ({
  slug: 'random-selections',
  access: {
    /**
     * WHO MAY ADD A DRAW, which this reasoned about three operations and
     * forgot.
     *
     * Payload fills an absent rule with `({ req: { user } }) => Boolean(user)`
     * — any signed-in account — so while delete, read and update each carried
     * an argument, `create` was open to every pupil and parent with a
     * password. A receipt they inserted would get chain fields from the
     * beforeChange hook and sit in the trail looking exactly like a draw the
     * school ran.
     *
     * The same roles the draw tools allow, and no wider: the gate nobody
     * writes is the gate standing open.
     */
    create: canDraw,
    // Nothing may delete a draw: the trail art. 30 requires be kept is not
    // the school's to tidy up, and a deletion is what the chain exists to
    // make visible.
    delete: () => false,
    // A parent or pupil reads their own class's draws and no other. This is
    // what the promise of "an inclusion proof a parent can verify without
    // being shown every other pupil's draw" actually requires; stated here,
    // where the database enforces it, rather than only in a tool.
    read: isOwnClass('class'),
    // Nor amend one. A receipt is evidence about a past event.
    update: () => false,
  },
  fields: [
    ...tenantField(options),
    {
      name: 'class',
      type: 'text',
      admin: {
        description: describe('drawClass'),
      },
      index: true,
    },
    {
      name: 'seq',
      type: 'number',
      admin: { description: describe('chainSeq') },
      index: true,
      required: true,
    },
    {
      name: 'prevHash',
      type: 'text',
      admin: { description: describe('chainPrev') },
      required: true,
    },
    {
      name: 'chainHash',
      type: 'text',
      admin: { description: describe('chainHash') },
      index: true,
      required: true,
      // H(seq ‖ prevHash ‖ contentAddress). Unique on its own: two identical
      // links cannot both be real.
      unique: true,
    },
    { name: 'receipt', type: 'json', required: true },
    { name: 'hmac', type: 'text' },
    {
      name: 'serverSeed',
      type: 'text',
      admin: {
        description: describe('serverSeed'),
      },
    },
    {
      name: 'outcomePublished',
      type: 'checkbox',
      admin: {
        description: describe('calendarAllDay'),
      },
      defaultValue: false,
    },
    {
      name: 'qpu',
      type: 'json',
      admin: { description: describe('qpuMirror') },
    },
  ],
  hooks: { beforeChange: [linkIntoChain] },
  // The anti-fork guarantee, as a constraint the database enforces rather
  // than a sentence in a docstring.
  ...(options.multiTenant === false
    ? {}
    : { indexes: [{ fields: ['tenant', 'seq'], unique: true }] }),
})

const roots = (options: FairPluginOptions): CollectionConfig => ({
  slug: 'receipt-roots',
  access: {
    // A seal is written by whoever runs the sealing, which is staff. Absent,
    // any signed-in account could publish a root and every later audit would
    // measure the chain against it.
    create: canDraw,
    // The root a parent checks a proof against. Readable by the audience the
    // proof is for, which is anyone the school has signed in — a root is a
    // hash of hashes and names nobody.
    read: isAuthenticated,
    // A seal is evidence about a past state. Nothing amends or removes one,
    // for the same reason nothing amends a receipt.
    delete: () => false,
    update: () => false,
  },
  fields: [
    ...tenantField(options),
    {
      name: 'root',
      type: 'text',
      admin: { description: describe('checkpointRoot') },
      required: true,
    },
    {
      name: 'chainLength',
      type: 'number',
      admin: { description: describe('checkpointLength') },
      required: true,
    },
    { name: 'leafCount', type: 'number', required: true },
    { name: 'sealedAt', type: 'date', index: true, required: true },
  ],
})

/**
 * Adds the selection trail and its constraints.
 *
 * Single-school instances pass `multiTenant: false`; the unique index then
 * falls back to `seq` alone, which is the same guarantee for one chain.
 */
export const fairSelectionPlugin =
  (options: FairPluginOptions = {}): Plugin =>
  (config) => {
    const single = options.multiTenant === false

    const selectionsCollection = single
      ? {
          ...selections(options),
          fields: selections(options).fields.map((field) =>
            'name' in field && field.name === 'seq' ? { ...field, unique: true } : field,
          ),
        }
      : selections(options)

    return {
      ...config,
      collections: withCollections(config, [selectionsCollection, roots(options)]),
    }
  }
