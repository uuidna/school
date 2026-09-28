import type { PayloadRequest } from 'payload'

import type { SchoolMcpTool } from './registry.js'

import { verifyChain } from '../fair/chain.js'
import { merkleRoot } from '../fair/merkle.js'
import { countAll, findAll } from '../payload/findAll.js'
import { andWhere, tenantOf, tenantWhere } from '../payload/scope.js'
import { ensureFirstTenant } from '../tenancy.js'
import { STAFF_ROLES } from '../access/roles.js'
import { resolveSource } from '../sources/resolve.js'
import { jurisdictionFor, resolveJurisdiction } from '../packs/index.js'
import { json, str } from './registry.js'

/**
 * The statutory duties come from the jurisdiction pack, not from this file.
 *
 * A school in another legal system swaps the pack; the engine below does not
 * change. The pack is resolved **per request**, from the school's own record:
 * one deployment serves schools under different legal systems, and a constant
 * bound at import cannot tell them apart — it would audit a Greek school
 * against Bulgarian law and report it compliant.
 *
 * `LEGAL_PUBLICATIONS` remains the default pack's list, because the
 * provisioning script and the tests read the same list the check reads — if
 * they drifted, a school could pass its own audit against the wrong law.
 */
export const LEGAL_PUBLICATIONS = jurisdictionFor().publications

/** The law this request's school answers to, and where that was decided. */
const lawFor = async (req: PayloadRequest) => {
  const tenant = await tenantOf(req.payload, req)

  // depth 0 above returns ids only for relationships, but the tenant's own
  // scalar fields are present; a tenant without `jurisdiction` falls back.
  return resolveJurisdiction(tenant as null | { jurisdiction?: unknown })
}

/**
 * Every document, not the first page of them: a statutory act sitting past an
 * arbitrary cap would be reported as unpublished.
 *
 * Read through the source port, so a school whose acts live in Drive is checked
 * against Drive. Reading Payload directly here would report every one of its
 * documents missing and tell it, in an inspection report, that it was not
 * compliant.
 */
const fetchPublishedDocuments = async (req: PayloadRequest) => {
  const { reason, source, system } = await resolveSource(req)
  return { documents: await source.listDocuments(), reason, system }
}

export const complianceTools: SchoolMcpTool[] = [
  {
    name: 'school_legal_publication_status',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: ['documents'],
    description:
      'Checks the documents this school’s law requires it to publish against what is actually on the site, and names the provision behind each gap. The duties come from the jurisdiction pack, so the citations are that country’s own. This is the question an inspection asks.',
    inputSchema: { type: 'object' },
    writes: false,
    handler: async (_args, req) => {
      const law = await lawFor(req)
      const { documents, reason, system } = await fetchPublishedDocuments(req)

      const checked = law.pack.publications.map((duty) => {
        // Every match, not the first. Two documents answering one duty is a
        // fact an inspector needs — a current act beside a superseded one is
        // the ordinary case, and picking whichever sorted first would hide it.
        const matches = documents.filter((doc) =>
          doc.title.toLowerCase().includes(duty.match),
        )

        // A duty is discharged by a document the public can actually obtain.
        // A row carrying a title and nothing else is a record that the school
        // *means* to publish, which is not the same as having published, and
        // reporting it as compliant is how an inspection is failed on paper
        // the school believed was in order.
        // The source decides reachability: a CMS row needs a file or a link, a
        // Drive file is the artefact. Re-deriving it here would get one wrong.
        const reachable = matches.filter((doc) => doc.reachable)

        const chosen = reachable[0] ?? matches[0]

        return {
          basis: duty.basis,
          published: reachable.length > 0,
          requirement: duty.name,
          ...(matches.length > 1
            ? { candidates: matches.map((doc) => doc.title), note: 'more than one document matches this duty' }
            : {}),
          ...(chosen
            ? {
                document: chosen.title,
                // Recorded but not obtainable: the gap an inspection finds.
                recordedOnly: reachable.length === 0,
                url: chosen.url ?? null,
              }
            : {}),
        }
      })

      const missing = checked.filter((entry) => !entry.published)

      return json({
        compliant: missing.length === 0,
        checkedAt: new Date().toISOString(),
        // Named, never implied: an inspection must be able to see which legal
        // system produced this answer, and whether anyone actually chose it.
        jurisdiction: { code: law.code, name: law.pack.name, source: law.source },
        // Which system answered. An inspection report that does not say where
        // it looked cannot be checked by anyone who thinks it looked elsewhere.
        readFrom: { reason, system },
        missing: missing.map((entry) => ({
          basis: entry.basis,
          reason: entry.document ? 'recorded, but no file or link to publish' : 'no document matches this duty',
          requirement: entry.requirement,
        })),
        published: checked.filter((entry) => entry.published).length,
        requirements: checked,
        total: checked.length,
      })
    },
  },
  {
    name: 'school_fairness_audit',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: ['selections'],
    description:
      'Verifies the provably fair selection trail: recomputes every link in the receipt chain and reports the first break, with the sealed checkpoints. Use before publishing lottery or admission results.',
    inputSchema: {
      properties: {
        trustCheckpoint: {
          description:
            'Verify only the receipts sealed after the newest checkpoint, taking the prefix on the checkpoint\'s word. Far cheaper and a WEAKER claim: an edit inside the sealed range is invisible. The answer says which was done. Default false.',
          type: 'boolean',
        },
      },
      type: 'object',
    },
    writes: false,
    handler: async (args, req) => {
      const trustCheckpoint = args.trustCheckpoint === true

      /**
       * THE FETCH FOLLOWS THE VERIFICATION, and may not be cheaper than it.
       *
       * Reading fewer rows than are verified is the defect findAll was written
       * against: "a chain verified to a ceiling reports intact about the part
       * it happened to read." So the suffix is fetched only when the prefix is
       * being taken on the checkpoint's word — the two are one decision, and
       * the report carries it.
       *
       * The checkpoint is read FIRST when it is going to be trusted, because
       * its chainLength is what bounds the second query. Read in parallel it
       * could not be: the audit would have to fetch everything to discover it
       * needed almost none of it, which is the cost being removed.
       */
      const roots = await findAll<{ chainLength?: number; head?: string; leafCount?: number; root?: string; sealedAt?: string }>(
        req.payload,
        { collection: 'receipt-roots', req, sort: '-sealedAt' },
      )
      const latest = roots[0]
      const from = trustCheckpoint && latest?.head && latest.chainLength ? latest.chainLength : 0

      const selections = await findAll<{
        chainHash?: null | string
        id: number | string
        prevHash?: null | string
        qpu?: unknown
        receipt?: unknown
        seq?: null | number
      }>(req.payload, {
        collection: 'random-selections',
        req,
        sort: 'seq',
        // `greater_than` on the sealed position: the links after the seal.
        ...(from > 0 ? { where: { seq: { greater_than: from } } } : {}),
      })

      // The newest seal is the outside witness of how long this chain already
      // was. Without it, removing the most recent draws breaks no link — there
      // is nothing after them to break — and the audit reports "intact" about
      // whatever survived the deletion.
      const latestSeal = roots[0]

      const chain = await verifyChain(
        selections.map((doc) => ({
          chainHash: doc.chainHash,
          id: doc.id,
          prevHash: doc.prevHash,
          receipt: doc.receipt,
          seq: doc.seq,
        })),
        typeof latestSeal?.chainLength === 'number'
          ? {
              chainLength: latestSeal.chainLength,
              ...(latestSeal.head ? { head: latestSeal.head } : {}),
              root: latestSeal.root,
              sealedAt: latestSeal.sealedAt,
            }
          : undefined,
        { trustCheckpoint },
      )

      // Recompute the seal from the receipts it was sealed over. Truncation
      // shortens the chain; editing a sealed receipt leaves the length alone
      // and changes the root, so both are asked separately.
      const sealCheck = await (async () => {
        if (!latestSeal?.root || typeof latestSeal.chainLength !== 'number') {
          return { reason: 'no checkpoint has been sealed yet', verified: false }
        }
        const sealed = selections.slice(0, latestSeal.chainLength)
        if (sealed.length < latestSeal.chainLength) {
          return { reason: 'fewer receipts remain than the checkpoint sealed', verified: false }
        }
        const leaves = sealed
          .map((doc) => (doc.receipt as { contentAddress?: string } | undefined)?.contentAddress)
          .filter((address): address is string => Boolean(address))
        if (leaves.length !== sealed.length) {
          return { reason: 'a sealed receipt carries no content address', verified: false }
        }
        const recomputed = await merkleRoot(leaves)
        return recomputed === latestSeal.root
          ? { verified: true }
          : { reason: `recomputed root ${recomputed} does not match the sealed ${latestSeal.root}`, verified: false }
      })()

      const unmirrored = selections.filter(
        (doc) => (doc.qpu as { status?: string } | null)?.status === 'failed',
      ).length

      return json({
        chain,
        // Stated rather than implied: an auditor should be able to see that the
        // seal was checked, or why it could not be.
        checkpointVerified: sealCheck,
        checkpoints: roots.map((root) => ({
          chainLength: root.chainLength,
          leafCount: root.leafCount,
          root: root.root,
          sealedAt: root.sealedAt,
        })),
        selections: selections.length,
        // A receipt the external witness never received is still valid locally;
        // it is reported because an auditor should know which ones they are.
        unmirroredReceipts: unmirrored,
      })
    },
  },
  {
    name: 'school_data_protection_report',
    allowedRoles: ['admin'],
    needs: ['people', 'audit'],
    description:
      'Data-protection posture for the school: who holds each role, which collections carry pupils\' personal data, and the recent access changes with their stated reasons — art. 5(2) and art. 30 of Regulation (EU) 2016/679.',
    inputSchema: { type: 'object' },
    writes: false,
    handler: async (_args, req) => {
      // Users in full — a role distribution that omits people is not a role
      // distribution. The access log is deliberately a window, and says so.
      const RECENT_CHANGES = 20
      const { reason: readReason, source, system } = await resolveSource(req)

      const [users, log, totalChanges] = await Promise.all([
        source.listPeople(),
        source.listAccessChanges({ limit: RECENT_CHANGES }),
        source.countAccessChanges(),
      ])

      const law = await lawFor(req)
      const roleCounts: Record<string, number> = {}
      for (const user of users) {
        const role = String(user.role ?? 'unknown')
        roleCounts[role] = (roleCounts[role] ?? 0) + 1
      }

      const withoutReason = log.filter((entry) => !entry.reason).length

      return json({
        accessChangesRecorded: totalChanges,
        changesWithoutStatedReason: withoutReason,
        generatedAt: new Date().toISOString(),
        dataProtectionRegime: law.pack.dataProtectionRegime,
        auditRetentionDays: law.pack.auditRetentionDays,
        jurisdiction: { code: law.code, name: law.pack.name, source: law.source },
        personalDataCollections: {
          note: 'Not exposed over MCP — art. 5(1)(c), data minimisation.',
          pupilRecords: ['students', 'grades', 'attendance', 'random-selections'],
        },
        readFrom: { reason: readReason, system },
        recentAccessChangesShown: Math.min(RECENT_CHANGES, totalChanges),
        recentAccessChanges: log,
        roleCounts,
        staffWithPupilDataAccess: users.filter((user) =>
          STAFF_ROLES.includes(user.role as never),
        ).length,
      })
    },
  },
  {
    name: 'school_compliance_report',
    allowedRoles: ['admin'],
    description:
      'One call for the whole picture: statutory publications, the fairness chain, and the data-protection posture. Intended for the start of a school year and before an inspection.',
    inputSchema: { type: 'object' },
    writes: false,
    handler: async (args, req) => {
      const run = async (name: string) => {
        const tool = complianceTools.find((entry) => entry.name === name)!
        const result = await tool.handler(args, req)
        return JSON.parse(result.content[0]!.text)
      }

      const [publications, fairness, dataProtection] = await Promise.all([
        run('school_legal_publication_status'),
        run('school_fairness_audit'),
        run('school_data_protection_report'),
      ])

      return json({
        dataProtection,
        fairness,
        generatedAt: new Date().toISOString(),
        publications,
        summary: {
          chainIntact: fairness.chain?.intact ?? null,
          missingPublications: publications.missing?.length ?? null,
          publicationsCompliant: publications.compliant,
        },
      })
    },
  },
  {
    name: 'school_record_required_document',
    allowedRoles: ['admin', 'registrar'],
    needs: ['documents'],
    description:
      'Records a statutory document in the typology with the provision that requires it. Use when the school adopts or replaces one of the acts its jurisdiction requires.',
    inputSchema: {
      properties: {
        category: str('Section of the typology, as this school names it'),
        legalBasis: str('The provision requiring it, cited as this jurisdiction cites it'),
        link: str('URL of the published page or file'),
        note: str('Short note shown beside the title'),
        title: str('Document title as adopted'),
      },
      required: ['title', 'legalBasis'],
      type: 'object',
    },
    writes: true,
    handler: async (args, req) => {
      const title = String(args.title)

      const existing = await req.payload.find({
        collection: 'documents',
        limit: 1,
        overrideAccess: false,
        req,
        where: andWhere(await tenantWhere(req.payload, req, 'documents'), {
          title: { equals: title },
        }),
      })

      // Documents belong to a school, and a school being provisioned has none
      // yet. The host names it — the same rule that lets the first user sign in
      // before any tenant exists.
      const tenant = await ensureFirstTenant(req.payload, req)

      const data = {
        category: args.category ?? undefined,
        legalBasis: args.legalBasis,
        link: args.link ?? undefined,
        note: args.note ?? undefined,
        title,
        ...(tenant ? { tenant: tenant.id } : {}),
      }

      const doc = existing.docs[0]
        ? await req.payload.update({
            collection: 'documents',
            data: data as never,
            id: existing.docs[0].id,
            overrideAccess: false,
            req,
          })
        : await req.payload.create({
            collection: 'documents',
            data: data as never,
            overrideAccess: false,
            req,
          })

      return json({ action: existing.docs[0] ? 'updated' : 'created', id: doc.id, legalBasis: args.legalBasis, title })
    },
  },
]
