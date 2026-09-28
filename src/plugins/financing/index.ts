import { withCollections } from '../collections.js'
import { programmeAddress } from '../../financing/provenance.js'
import { isAdminOrRegistrar, isAuthenticated } from '../../access/roles.js'
import { describe } from '../../i18n/admin.js'

import type { CollectionBeforeChangeHook, CollectionConfig, Plugin } from 'payload'

/**
 * Where financing programmes are kept.
 *
 * Not tenant-scoped, and that is deliberate: a programme published by the
 * European Commission is the same programme for every school on the instance.
 * Scoping it would make each school maintain its own copy of a public
 * catalogue, and copies of a catalogue drift.
 *
 * The collection's job is to refuse anything invented. Provenance is required
 * at the schema level rather than only in the engine, because a row that got
 * into the database without it is a row somebody will later read out of the
 * database and trust. A programme that cannot name the API it came from and
 * when it was read is not admissible for a decision about public money.
 */

export type FinancingPluginOptions = {
  /** Sources a programme may be recorded from. Free text when unset. */
  allowedApis?: string[]
}

export const financingProgrammes = (options: FinancingPluginOptions = {}): CollectionConfig => ({
  slug: 'financing-programmes',
  hooks: { beforeChange: [sealOnWrite()] },
  /**
   * A FUNDING CATALOGUE IS NOT A THING A PUPIL MAY EDIT, and with no rules at
   * all every one of these operations defaulted to "is anybody signed in".
   *
   * Read is wide on purpose: school_researcher_financing exists so a pupil
   * can ask what they could apply for, and a programme is public information
   * its authority already published. Writing is administrative — a row
   * somebody adds here is a row the engine will assess a school against.
   */
  access: {
    create: isAdminOrRegistrar,
    delete: isAdminOrRegistrar,
    read: isAuthenticated,
    update: isAdminOrRegistrar,
  },
  admin: { defaultColumns: ['name', 'authority', 'closes', 'fetchedAt'], useAsTitle: 'name' },
  fields: [
    { name: 'programmeId', type: 'text', index: true, required: true, unique: true },
    { name: 'name', type: 'text', required: true },
    { name: 'authority', type: 'text', required: true },
    {
      name: 'basis',
      type: 'text',
      admin: { description: describe('legalBasis') },
    },
    {
      name: 'provenance',
      type: 'group',
      admin: {
        description: describe('provenance'),
      },
      fields: [
        // Constrained to a list of sources where a deployment names them, so
        // a programme cannot be attributed to an API nobody publishes.
        options.allowedApis?.length
          ? {
              name: 'api',
              type: 'select' as const,
              options: options.allowedApis,
              required: true,
            }
          : { name: 'api', type: 'text' as const, required: true },
        { name: 'fetchedAt', type: 'date', required: true },
        { name: 'reference', type: 'text' },
        { name: 'url', type: 'text' },
        {
          name: 'contentAddress',
          type: 'text',
          admin: { description: describe('contentHash'), readOnly: true },
        },
      ],
    },
    {
      /**
       * The marker that keeps an empty criteria list honest.
       *
       * It had no column, so an EU call stored and read back came out with no
       * conditions and no marker and assessed as eligible for everybody —
       * zero conditions, all of them met. The engine now also refuses to read
       * silence as "no conditions", so this is the record being kept faithful
       * rather than the only thing standing between a school and a wrong
       * answer.
       */
      name: 'conditionsUnparsed',
      type: 'group',
      fields: [
        { name: 'reason', type: 'textarea' },
        { name: 'url', type: 'text' },
      ],
    },
    {
      name: 'opens',
      type: 'date',
      admin: { description: describe('programmeWindow') },
    },
    { name: 'closes', type: 'date' },
    {
      name: 'criteria',
      type: 'array',
      admin: {
        description: describe('criteriaData'),
      },
      fields: [
        { name: 'criterionId', type: 'text', required: true },
        { name: 'describe', type: 'textarea', required: true },
        { name: 'field', type: 'text', required: true },
        {
          name: 'op',
          type: 'select',
          options: ['eq', 'neq', 'gte', 'lte', 'in', 'has'],
          required: true,
        },
        { name: 'value', type: 'json', required: true },
      ],
    },
    {
      name: 'requires',
      type: 'array',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'match', type: 'text', required: true },
        {
          name: 'mustBeObtainable',
          type: 'checkbox',
          admin: { description: describe('requiresFile') },
          defaultValue: true,
        },
      ],
    },
    {
      name: 'workflow',
      type: 'array',
      admin: { description: describe('workflowStages') },
      fields: [{ name: 'stage', type: 'text', required: true }],
    },
  ],
})

/**
 * A national catalogue, kept as a catalogue.
 *
 * Not flattened into `financing-programmes`, and that is the point. Staleness
 * is a property of the catalogue — the year the act covers — and these are
 * revised annually. Writing the programmes out individually would freeze how
 * stale they were at the moment somebody recorded them, so a 2026 catalogue
 * read in 2028 would still describe itself as current.
 *
 * Global rather than per-school for the same reason the EU catalogue is: the
 * programmes Bulgaria approved are the same programmes for every Bulgarian
 * school, and per-school copies of one act drift apart.
 */
export const nationalCatalogues = (): CollectionConfig => ({
  slug: 'national-catalogues',
  // The same reasoning, and the stakes are higher: a catalogue names the act
  // that approved it, and the engine treats that citation as what makes a
  // declared list admissible at all.
  access: {
    create: isAdminOrRegistrar,
    delete: isAdminOrRegistrar,
    read: isAuthenticated,
    update: isAdminOrRegistrar,
  },
  admin: { defaultColumns: ['jurisdiction', 'year', 'authority'], useAsTitle: 'authority' },
  fields: [
    {
      name: 'jurisdiction',
      type: 'text',
      admin: { description: describe('jurisdictionCode') },
      index: true,
      required: true,
    },
    {
      name: 'year',
      type: 'number',
      admin: { description: describe('catalogueYear') },
      index: true,
      required: true,
    },
    { name: 'authority', type: 'text', required: true },
    {
      name: 'approvedBy',
      type: 'group',
      admin: {
        description: describe('actCitation'),
      },
      fields: [
        {
          name: 'act',
          type: 'text',
          admin: { description: describe('actCitation') },
          required: true,
        },
        { name: 'date', type: 'date', admin: { description: describe('actDate') }, required: true },
        { name: 'url', type: 'text' },
      ],
    },
    {
      name: 'programmes',
      type: 'array',
      fields: [
        { name: 'programmeId', type: 'text', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'opens', type: 'date' },
        { name: 'closes', type: 'date' },
        { name: 'url', type: 'text' },
        { name: 'budgetAmount', type: 'number' },
        { name: 'budgetCurrency', type: 'text' },
      ],
      minRows: 1,
      required: true,
    },
  ],
  // One catalogue per jurisdiction per year: two would be two answers to the
  // same question, and nothing would say which act was in force.
  indexes: [{ fields: ['jurisdiction', 'year'], unique: true }],
})


/**
 * The content address, sealed wherever a programme is written.
 *
 * `sealProgramme` ran in the loaders, so a programme read from the portal
 * carried an address and one typed into the admin panel carried none — and a
 * record with no address is reported undecidable for the rest of its life.
 * Half the catalogue could not answer the question the other half could.
 *
 * WHAT A RE-SEAL MEANS, because this is the part that could quietly hollow
 * the check out. Sealing on every write would make an edit invisible: change
 * a deadline, get a fresh address, and `verifyProgramme` says verified. So an
 * edit does not merely re-seal — it restates the provenance. A row loaded
 * from the portal and then changed here is no longer what the portal
 * published, and its `api` says so: whoever last asserted this record is who
 * the record now names. The address then means what it always meant —
 * unchanged since asserted — and the assertion has an author.
 */
const sealOnWrite =
  (): CollectionBeforeChangeHook =>
  async ({ data, operation, originalDoc, req }) => {
    const provenance = (data.provenance ?? {}) as Record<string, unknown>
    if (!provenance.api || !provenance.fetchedAt) return data

    const edited =
      operation === 'update' &&
      originalDoc !== undefined &&
      JSON.stringify({ ...data, provenance: null }) !==
        JSON.stringify({ ...originalDoc, provenance: null })

    const actor = req?.user ? ((req.user as { email?: string }).email ?? 'a signed-in user') : 'a script'

    const stated = edited
      ? {
          ...provenance,
          api: `entered:${actor}`,
          fetchedAt: new Date().toISOString(),
          ...(provenance.api && !String(provenance.api).startsWith('entered:')
            ? { reference: `was ${String(provenance.api)}` }
            : {}),
        }
      : provenance

    const programme = {
      authority: String(data.authority ?? ''),
      ...(data.basis ? { basis: String(data.basis) } : {}),
      ...(data.conditionsUnparsed ? { conditionsUnparsed: data.conditionsUnparsed } : {}),
      criteria: (data.criteria ?? []) as never,
      id: String(data.programmeId ?? ''),
      name: String(data.name ?? ''),
      provenance: stated as never,
      ...(data.requires ? { requires: data.requires } : {}),
      ...(data.opens || data.closes
        ? { window: { ...(data.closes ? { closes: String(data.closes) } : {}), ...(data.opens ? { opens: String(data.opens) } : {}) } }
        : {}),
      ...(data.workflow ? { workflow: (data.workflow as { stage?: string }[]).map((w) => w.stage ?? '') } : {}),
    } as never

    return {
      ...data,
      provenance: { ...stated, contentAddress: await programmeAddress(programme) },
    }
  }

export const financingPlugin =
  (options: FinancingPluginOptions = {}): Plugin =>
  (config) => ({
    ...config,
    collections: withCollections(config, [financingProgrammes(options), nationalCatalogues()]),
  })
