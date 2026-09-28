import type { PayloadRequest } from 'payload'

import type { Applicant, FinancingProgramme } from '../financing/types.js'
import type { SchoolMcpTool } from './registry.js'

import type { NationalCatalogue } from '../financing/national.js'

import { bounded, UNTRUSTED_NOTE } from '../sources/untrusted.js'
import { assessAll } from '../financing/assess.js'
import { loadNationalProgrammes, staleness } from '../financing/national.js'
import { loadEuProgrammes } from '../financing/eu.js'
import { byTheme, EU_THEME } from '../financing/themes.js'
import { applicationPlan } from '../financing/readiness.js'
import { resolveJurisdiction } from '../packs/index.js'
import { findAll } from '../payload/findAll.js'
import { tenantOf } from '../payload/scope.js'
import { enumOf, failure, json, str } from './registry.js'

type CatalogueRow = {
  approvedBy?: { act?: string; date?: string; url?: string }
  authority?: string
  jurisdiction?: string
  programmes?: {
    budgetAmount?: number
    budgetCurrency?: string
    closes?: string
    name?: string
    opens?: string
    programmeId?: string
    url?: string
  }[]
  year?: number
}

/** The row as the loader's shape. Anything unusable is left to it to refuse. */
const toCatalogue = (row: CatalogueRow): NationalCatalogue => ({
  approvedBy: {
    act: row.approvedBy?.act ?? '',
    date: row.approvedBy?.date ?? '',
    ...(row.approvedBy?.url ? { url: row.approvedBy.url } : {}),
  },
  authority: row.authority ?? '',
  jurisdiction: row.jurisdiction ?? '',
  programmes: (row.programmes ?? []).map((entry) => ({
    ...(typeof entry.budgetAmount === 'number' && entry.budgetCurrency
      ? { budget: { amount: entry.budgetAmount, currency: entry.budgetCurrency } }
      : {}),
    ...(entry.closes ? { closes: entry.closes } : {}),
    id: entry.programmeId ?? '',
    name: entry.name ?? '',
    ...(entry.opens ? { opens: entry.opens } : {}),
    ...(entry.url ? { url: entry.url } : {}),
  })),
  year: row.year ?? 0,
})

/**
 * The national programmes in force for this school's jurisdiction.
 *
 * Loaded from the catalogue on every call rather than flattened into the
 * programme table when it was recorded. Staleness is a property of the
 * catalogue's year, so freezing it at write time would let a 2026 list go on
 * describing itself as current in 2028.
 *
 * The newest year first: a school wants the act in force, and the older ones
 * are kept because an application made under one is judged under it.
 */
const nationalFor = async (req: PayloadRequest, jurisdiction: string, now = new Date()) => {
  const rows = await findAll<CatalogueRow>(req.payload, {
    collection: 'national-catalogues',
    req,
    sort: '-year',
    where: { jurisdiction: { equals: jurisdiction } },
  })

  const newest = rows[0]
  if (!newest) return { age: undefined, catalogue: undefined, programmes: [] }

  const catalogue = toCatalogue(newest)

  try {
    return {
      age: staleness(catalogue, now),
      catalogue,
      programmes: await loadNationalProgrammes(catalogue, now),
    }
  } catch (error) {
    // A catalogue the loader refuses is reported, not silently skipped: a
    // school shown no national programmes cannot tell that from there being
    // none.
    return {
      age: undefined,
      catalogue,
      programmes: [],
      refused: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Financing over MCP.
 *
 * Two audiences, and the difference between them is the whole design.
 *
 * Staff ask about the **school**: its profile is read from the school's own
 * record, and the answer concerns an institution.
 *
 * A researcher asks about **themselves**, and uuidna exists to support them
 * whatever their age — so a pupil must be able to ask. That tool therefore
 * takes the applicant's profile **as arguments and reads no record of any
 * person**: it touches the programme catalogue, which is public, and nothing
 * else. It writes nothing, and it stores no profile. A minor can be assessed
 * without a single field about them being read from or written to a database,
 * which is the only way to put this on a surface that deliberately excludes
 * pupils' records.
 */

type ProgrammeRow = {
  authority?: string
  basis?: string
  closes?: string
  conditionsUnparsed?: { reason?: string; url?: string }
  criteria?: { criterionId?: string; describe?: string; field?: string; op?: string; value?: unknown }[]
  name?: string
  opens?: string
  programmeId?: string
  provenance?: {
    api?: string
    contentAddress?: string
    fetchedAt?: string
    reference?: string
    url?: string
  }
  requires?: { match?: string; mustBeObtainable?: boolean; name?: string }[]
  workflow?: { stage?: string }[]
}

/** The stored row as the engine's shape. Rows without provenance are dropped. */
const toProgramme = (row: ProgrammeRow): FinancingProgramme | undefined => {
  if (!row.provenance?.api || !row.provenance?.fetchedAt) return undefined

  return {
    authority: bounded(row.authority),
    ...(row.basis ? { basis: row.basis } : {}),
    // Restored, because dropping it was what made a stored EU call assess as
    // eligible for everybody.
    ...(row.conditionsUnparsed?.reason
      ? {
          conditionsUnparsed: {
            reason: row.conditionsUnparsed.reason,
            ...(row.conditionsUnparsed.url ? { url: row.conditionsUnparsed.url } : {}),
          },
        }
      : {}),
    criteria: (row.criteria ?? []).map((criterion) => ({
      describe: criterion.describe ?? '',
      field: criterion.field ?? '',
      id: criterion.criterionId ?? '',
      op: criterion.op as never,
      value: criterion.value as never,
    })),
    id: row.programmeId ?? '',
    name: bounded(row.name),
    provenance: {
      api: row.provenance.api,
      ...(row.provenance.contentAddress ? { contentAddress: row.provenance.contentAddress } : {}),
      fetchedAt: row.provenance.fetchedAt,
      ...(row.provenance.reference ? { reference: row.provenance.reference } : {}),
      ...(row.provenance.url ? { url: row.provenance.url } : {}),
    },
    ...(row.requires?.length
      ? {
          requires: row.requires.map((required) => ({
            match: (required.match ?? '').toLowerCase(),
            ...(required.mustBeObtainable === false ? { mustBeObtainable: false } : {}),
            name: required.name ?? '',
          })),
        }
      : {}),
    ...(row.opens || row.closes
      ? { window: { ...(row.closes ? { closes: row.closes } : {}), ...(row.opens ? { opens: row.opens } : {}) } }
      : {}),
    ...(row.workflow?.length
      ? { workflow: row.workflow.map((entry) => entry.stage ?? '').filter(Boolean) }
      : {}),
  }
}

const loadProgrammes = async (req: PayloadRequest) => {
  const rows = await findAll<ProgrammeRow>(req.payload, {
    collection: 'financing-programmes',
    req,
  })

  const usable = rows.map(toProgramme).filter((p): p is FinancingProgramme => p !== undefined)

  // Reported rather than silently dropped: a catalogue quietly missing entries
  // looks like a school with fewer options than it has.
  return { unusable: rows.length - usable.length, usable }
}

const lawFor = async (req: PayloadRequest) => {
  const tenant = await tenantOf(req.payload, req)
  return resolveJurisdiction(tenant as null | { jurisdiction?: unknown })
}

/** The school's own profile, from its record. Never invented. */
const schoolApplicant = async (req: PayloadRequest): Promise<Applicant> => {
  const tenant = (await tenantOf(req.payload, req)) as null | Record<string, unknown>
  const law = await lawFor(req)

  return {
    kind: 'institution',
    ...(typeof tenant?.region === 'string' ? { region: tenant.region } : {}),
    ...(typeof tenant?.schoolType === 'string' ? { schoolType: tenant.schoolType } : {}),
    ...(typeof tenant?.specialty === 'string' ? { specialty: tenant.specialty } : {}),
    ...(typeof tenant?.pupilCount === 'number' ? { pupilCount: tenant.pupilCount } : {}),
    jurisdiction: law.code,
  }
}

export const financingMcpTools: SchoolMcpTool[] = [
  {
    name: 'school_national_programmes',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: [],
    description:
      'The national programmes in force for this school’s jurisdiction, with the act that approved them and how old that act is. National programmes are revised annually, so a catalogue from a previous year is reported as possibly superseded rather than quietly used.',
    inputSchema: { type: 'object' },
    writes: false,
    handler: async (_args, req) => {
      const law = await lawFor(req)
      const national = await nationalFor(req, law.code)

      if (national.refused) {
        return failure(
          `The recorded catalogue for "${law.code}" cannot be used: ${national.refused}`,
        )
      }

      if (!national.catalogue) {
        return json({
          jurisdiction: { code: law.code, name: law.pack.name, source: law.source },
          note: `No national programme catalogue has been recorded for "${law.code}". These are published as documents rather than as a feed, so somebody records them with the act that approved them — school_record_national_catalogue does that.`,
          programmes: [],
        })
      }

      const applicant = await schoolApplicant(req)
      const assessed = await assessAll(national.programmes, applicant, law.pack)

      return json({
        approvedBy: national.catalogue.approvedBy,
        authority: national.catalogue.authority,
        checkedAt: new Date().toISOString(),
        jurisdiction: { code: law.code, name: law.pack.name, source: law.source },
        programmes: assessed.map((entry) => ({
          eligible: entry.eligible,
          programme: entry.programme,
          provenance: entry.provenance,
          // Stated beside the provenance it checks. Undefined where there is
          // no address to check against — an answer that said nothing here
          // would read as though everything had been verified.
          provenanceVerified: entry.provenanceVerified,
          undecidable: entry.undecidable.map((verdict) => verdict.reason),
          unmet: entry.unmet.map((verdict) => verdict.reason),
        })),
        // Stated where a reader will see it, not only inside each programme.
        staleness: national.age,
        year: national.catalogue.year,
      })
    },
  },
  {
    name: 'school_record_national_catalogue',
    allowedRoles: ['admin', 'registrar'],
    needs: [],
    description:
      'Records the national programmes approved for a jurisdiction and year, with the act that approved them. The act and its date are required: a list of programmes that cannot cite its act is indistinguishable from one typed from memory. Replaces the catalogue for that jurisdiction and year.',
    inputSchema: {
      properties: {
        act: str('The approving instrument, cited as this jurisdiction cites it'),
        actDate: str('Date of the act, ISO (YYYY-MM-DD)'),
        actUrl: str('Where the act or the programme list is published'),
        authority: str('Who administers them, as they name themselves'),
        jurisdiction: str('ISO 3166-1 alpha-2, lower case. Defaults to this school’s'),
        programmes: {
          description:
            'The programmes as the act lists them. Conditions are not taken: the authority publishes them as prose, and this package does not parse eligibility out of prose.',
          items: {
            properties: {
              closes: str('ISO date, if the act states one'),
              id: str('The programme’s number under the act, or its slug'),
              name: str('Programme name as adopted'),
              opens: str('ISO date, if the act states one'),
              url: str('Where this programme’s own conditions are published'),
            },
            required: ['id', 'name'],
            type: 'object',
          },
          type: 'array',
        },
        year: str('The year these programmes are for'),
      },
      required: ['act', 'actDate', 'authority', 'programmes', 'year'],
      type: 'object',
    },
    writes: true,
    handler: async (args, req) => {
      const law = await lawFor(req)
      const jurisdiction = String(args.jurisdiction ?? law.code)
      const year = Number(args.year)

      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return failure(`"${String(args.year)}" is not a year this catalogue can be filed under.`)
      }

      const programmes = (args.programmes ?? []) as {
        closes?: string
        id?: string
        name?: string
        opens?: string
        url?: string
      }[]

      const data = {
        approvedBy: {
          act: String(args.act),
          date: String(args.actDate),
          ...(args.actUrl ? { url: String(args.actUrl) } : {}),
        },
        authority: String(args.authority),
        jurisdiction,
        programmes: programmes.map((entry) => ({
          ...(entry.closes ? { closes: entry.closes } : {}),
          name: entry.name,
          ...(entry.opens ? { opens: entry.opens } : {}),
          programmeId: entry.id,
          ...(entry.url ? { url: entry.url } : {}),
        })),
        year,
      }

      // Refused here rather than on read: a catalogue that cannot be loaded
      // should not reach the database and wait to fail somebody's audit.
      try {
        await loadNationalProgrammes(toCatalogue(data as CatalogueRow), new Date())
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error))
      }

      const existing = await req.payload.find({
        collection: 'national-catalogues',
        limit: 1,
        overrideAccess: false,
        req,
        where: { and: [{ jurisdiction: { equals: jurisdiction } }, { year: { equals: year } }] },
      })

      const saved = existing.docs[0]
        ? await req.payload.update({
            collection: 'national-catalogues',
            data: data as never,
            id: existing.docs[0].id,
            overrideAccess: false,
            req,
          })
        : await req.payload.create({
            collection: 'national-catalogues',
            data: data as never,
            overrideAccess: false,
            req,
          })

      return json({
        act: data.approvedBy.act,
        action: existing.docs[0] ? 'updated' : 'created',
        id: saved.id,
        jurisdiction,
        programmes: data.programmes.length,
        year,
      })
    },
  },
  {
    name: 'school_load_eu_programmes',
    allowedRoles: ['admin', 'registrar'],
    needs: [],
    description:
      'Reads open and forthcoming calls from the European Commission’s Funding & Tenders portal and records them in this school’s catalogue. Narrow the read with a call identifier or a theme: the portal carries thousands of calls and a school has no use for a catalogue it cannot read. Nothing is invented — each programme keeps the portal’s own identifier, window and deadline model, and arrives marked as having conditions nobody has parsed.',
    inputSchema: {
      properties: {
        callIdentifier: str('A call identifier as the portal spells it, e.g. HORIZON-MSCA-2024-DN-01'),
        limit: str('Stop after this many programmes. Defaults to 50'),
        theme: enumOf(Object.keys(EU_THEME), 'A theme this package knows how to query for'),
      },
      required: [],
      type: 'object',
    },
    writes: true,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const identifier = String(args.callIdentifier ?? '').trim()
      const theme = String(args.theme ?? '').trim()

      if (!identifier && !theme) {
        return failure(
          'Name a callIdentifier or a theme. The portal holds thousands of open calls; loading all of them gives a school a catalogue nobody reads and a deadline list nobody can act on.',
        )
      }

      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 500)

      let loaded: FinancingProgramme[]
      try {
        loaded = await loadEuProgrammes({
          ...(identifier
            ? { must: [{ terms: { callIdentifier: [identifier] } }] }
            : byTheme(theme as never)),
        })
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error))
      }

      if (loaded.length === 0) {
        // An identifier the portal does not know returns an empty result with
        // HTTP 200 and no error, which reads exactly like a call with no
        // topics. Saying so is the difference between a school waiting for
        // programmes and a school checking its spelling.
        return failure(
          `The portal returned no programmes for ${identifier || theme}. An identifier it does not recognise is accepted and filters nothing out, so check the spelling against the portal rather than waiting for the catalogue to fill.`,
        )
      }

      const scope = await tenantOf(req.payload, req)
      const written: { action: string; id: string; name: string }[] = []

      for (const programme of loaded.slice(0, limit)) {
        const row = {
          authority: programme.authority,
          ...(programme.conditionsUnparsed
            ? { conditionsUnparsed: programme.conditionsUnparsed }
            : {}),
          criteria: [],
          name: programme.name,
          programmeId: programme.id,
          provenance: programme.provenance,
          ...(programme.window?.closes ? { closes: programme.window.closes } : {}),
          ...(programme.window?.opens ? { opens: programme.window.opens } : {}),
          // Carried through rather than resolved: the authority published two
          // windows for this call and choosing between them is the school's.
          ...(programme.windowDisputed ? { windowDisputed: programme.windowDisputed } : {}),
          ...(programme.workflow?.length
            ? { workflow: programme.workflow.map((stage) => ({ stage })) }
            : {}),
          ...(scope ? { tenant: scope.id } : {}),
        }

        const existing = await req.payload.find({
          collection: 'financing-programmes',
          limit: 1,
          overrideAccess: false,
          req,
          where: { programmeId: { equals: programme.id } },
        })

        if (existing.docs[0]) {
          await req.payload.update({
            collection: 'financing-programmes',
            data: row as never,
            id: existing.docs[0].id,
            overrideAccess: false,
            req,
          })
        } else {
          await req.payload.create({
            collection: 'financing-programmes',
            data: row as never,
            overrideAccess: false,
            req,
          })
        }

        written.push({
          action: existing.docs[0] ? 'updated' : 'created',
          id: programme.id,
          name: bounded(programme.name),
          ...(programme.windowDisputed
            ? {
                windowDisputed: `the portal published ${programme.windowDisputed.closes.length} different closing dates for this call across its language versions: ${programme.windowDisputed.closes.join(' and ')}. Check with the authority before planning against either.`,
              }
            : {}),
        })
      }

      return json({
        asked: identifier || `theme:${theme}`,
        // Reported rather than assumed: a portal read that found more than the
        // limit is a catalogue this school is holding only part of.
        found: loaded.length,
        note: UNTRUSTED_NOTE,
        readFrom: { api: 'eu:funding-tenders' },
        recorded: written.length,
        truncated: loaded.length > limit,
        untrusted: { fields: ['recorded[].name'] },
        written,
      })
    },
  },
  {
    name: 'school_financing_opportunities',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    description:
      'Which recorded financing programmes this school could pursue, ranked with the decided ones first. Reports what is undecidable and what would settle it, rather than guessing. Never reports a programme that cannot say where it was published.',
    inputSchema: { type: 'object' },
    writes: false,
    handler: async (_args, req) => {
      const { unusable, usable } = await loadProgrammes(req)
      const applicant = await schoolApplicant(req)
      const law = await lawFor(req)

      // National programmes belong in the same answer. A school asking what it
      // can apply for is not asking about one authority, and two tools it has
      // to remember to call separately is how a programme is missed.
      const national = await nationalFor(req, law.code)

      const assessed = await assessAll([...usable, ...national.programmes], applicant, law.pack)

      return json({
        applicant,
        // Named, because a flat object makes the school's own words and a
        // stranger's look identical to whatever reads this.
        untrusted: { fields: ['programme.name', 'programme.authority'], note: UNTRUSTED_NOTE },
        assessed: assessed.map((entry) => ({
          eligible: entry.eligible,
          met: entry.met.length,
          programme: entry.programme,
          provenance: entry.provenance,
          unmet: entry.unmet.map((verdict) => verdict.reason),
          // Named, so the school knows what to state in order to find out.
          // Stated beside the provenance it checks. Undefined where there is
          // no address to check against — an answer that said nothing here
          // would read as though everything had been verified.
          provenanceVerified: entry.provenanceVerified,
          undecidable: entry.undecidable.map((verdict) => verdict.reason),
        })),
        checkedAt: new Date().toISOString(),
        jurisdiction: { code: law.code, name: law.pack.name, source: law.source },
        summary: {
          eligible: assessed.filter((entry) => entry.eligible === true).length,
          ineligible: assessed.filter((entry) => entry.eligible === false).length,
          undecided: assessed.filter((entry) => entry.eligible === undefined).length,
        },
        // Where they came from, and what is wrong with either source.
        sources: {
          national: national.catalogue
            ? {
                act: national.catalogue.approvedBy.act,
                count: national.programmes.length,
                staleness: national.age,
                year: national.catalogue.year,
              }
            : { count: 0, note: `no national catalogue recorded for "${law.code}"` },
          recorded: { count: usable.length },
          ...(national.refused ? { nationalRefused: national.refused } : {}),
        },
        ...(unusable
          ? {
              excluded: unusable,
              excludedReason:
                'recorded without provenance — a programme that cannot name where it was published is not evaluated',
            }
          : {}),
      })
    },
  },
  {
    name: 'school_financing_plan',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    description:
      'What still stands between this school and one application: the window, eligibility, and whether the documents the authority asks for can actually be obtained. Names one next action rather than a list.',
    inputSchema: {
      properties: { programmeId: str('The programme to plan for') },
      required: ['programmeId'],
      type: 'object',
    },
    writes: false,
    handler: async (args, req) => {
      const { usable } = await loadProgrammes(req)
      const programme = usable.find((entry) => entry.id === String(args.programmeId))

      if (!programme) {
        return failure(
          `No usable programme "${String(args.programmeId)}". It may not be recorded, or may have been recorded without provenance.`,
        )
      }

      const documents = await findAll<Record<string, unknown>>(req.payload, {
        collection: 'documents',
        req,
      })

      const plan = await applicationPlan(
        programme,
        await schoolApplicant(req),
        documents.map((doc) => ({
          id: doc.id as number | string,
          reachable: Boolean(doc.filename) || Boolean(doc.url) || Boolean(doc.link),
          title: String(doc.title ?? ''),
          url: (doc.url as string) ?? (doc.link as string) ?? null,
        })),
        new Date(),
        (await lawFor(req)).pack,
      )

      return json(plan)
    },
  },
  {
    name: 'school_researcher_financing',
    // A pupil may ask what they could apply for, and a parent may ask on their
    // behalf. This reads NO record of any person — see below.
    allowedRoles: ['admin', 'parent', 'registrar', 'student', 'teacher'],
    description:
      "What an independent researcher could apply for, whatever their age. The applicant's details are supplied in the call and are neither read from nor written to any record; only the public programme catalogue is read. State isMinor rather than a date of birth. Where the applicant is a minor and guardian consent has not been established, the answer is undecided rather than a refusal.",
    inputSchema: {
      properties: {
        guardianConsentAt: str('When a guardian consented, ISO date — omit if not established'),
        guardianConsentBy: str('How consent was evidenced, e.g. the parents group address'),
        isMinor: enumOf(['yes', 'no', 'unstated'], 'Whether the applicant is a minor'),
        jurisdiction: str('ISO 3166-1 alpha-2, lower case. Defaults to this school’s'),
        region: str('Region, where a programme is regional'),
        subjects: str('Fields of research, comma separated'),
      },
      required: [],
      type: 'object',
    },
    writes: false,
    handler: async (args, req) => {
      const { unusable, usable } = await loadProgrammes(req)
      const law = await lawFor(req)

      const minor = String(args.isMinor ?? 'unstated')
      const consentAt = args.guardianConsentAt ? String(args.guardianConsentAt) : undefined
      const consentBy = args.guardianConsentBy ? String(args.guardianConsentBy) : undefined

      const applicant: Applicant = {
        kind: 'researcher',
        jurisdiction: args.jurisdiction ? String(args.jurisdiction) : law.code,
        ...(minor === 'yes' ? { isMinor: true } : minor === 'no' ? { isMinor: false } : {}),
        // Undefined means not established; null means asked and absent. Only a
        // stated consent becomes a record of one.
        ...(consentAt && consentBy
          ? { guardianConsent: { at: consentAt, evidencedBy: consentBy } }
          : {}),
        ...(args.region ? { region: String(args.region) } : {}),
        ...(args.subjects
          ? { subjects: String(args.subjects).split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
      }

      const assessed = await assessAll(usable, applicant, law.pack)

      return json({
        assessed: assessed.map((entry) => ({
          eligible: entry.eligible,
          guardianship: entry.guardianship,
          programme: entry.programme,
          provenance: entry.provenance,
          // Stated beside the provenance it checks. Undefined where there is
          // no address to check against — an answer that said nothing here
          // would read as though everything had been verified.
          provenanceVerified: entry.provenanceVerified,
          undecidable: entry.undecidable.map((verdict) => verdict.reason),
          unmet: entry.unmet.map((verdict) => verdict.reason),
        })),
        checkedAt: new Date().toISOString(),
        jurisdiction: { code: law.code, name: law.pack.name, source: law.source },
        // Stated plainly, because the applicant may be a child and the school
        // is accountable for what it does with their details.
        privacy:
          'Assessed from what was supplied in this call. Nothing about the applicant was read from, or written to, any record.',
        ...(unusable ? { excluded: unusable } : {}),
      })
    },
  },
]
