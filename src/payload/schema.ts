import type { Payload } from 'payload'

import { TENANT_PATH, tenantFieldOf } from './scope.js'

/**
 * What this package requires of a schema it does not own — decided, not stated.
 *
 * `@uuidna/school` defines no collections. They live in the host app, and two
 * of this package's guarantees rest entirely on their shape:
 *
 * - tenant confinement filters on a field named per collection in
 *   `TENANT_PATH`. Name it wrong and the filter targets a field that is not
 *   there, which is a silent wrong answer rather than an error;
 * - the receipt chain claims that two racing draws cannot fork it. That is true
 *   only if the database rejects the second insert, which is a unique index —
 *   without one the race forks the chain and every later verification passes.
 *
 * Both were written as prose in a docstring first. Prose is exactly what a
 * guard is for: a requirement nobody computes is a requirement nobody meets, so
 * this reads the host's sanitised config and answers from it. The answer is not
 * in this file — it is in whatever config the host passes in.
 */

export type SchemaFinding = {
  collection: string
  reason: string
  requirement: string
  satisfied: boolean
}

/**
 * Is a unique constraint in force over these paths?
 *
 * Satisfied by a unique index on **any subset** of them, because a narrower
 * unique index is a stronger promise, not a weaker one: unique on `seq` forbids
 * every duplicate that unique on `(tenant, seq)` forbids, and more besides. A
 * host that gives each school its own database and numbers receipts globally
 * meets the anti-fork requirement exactly; demanding the compound index by name
 * reported it as unmet and sent someone to write a migration that would have
 * loosened it.
 */
const hasUniqueIndexOn = (payload: Payload, collection: string, paths: string[]): boolean => {
  const config = payload.collections?.[collection]?.config
  if (!config) return false

  // A unique index on one field may be declared on the field itself.
  const fields = config.flattenedFields ?? []
  if (
    paths.some(
      (path) =>
        (fields.find((entry) => (entry as { name?: string }).name === path) as
          | { unique?: boolean }
          | undefined)?.unique,
    )
  ) {
    return true
  }

  const indexes = (config as { sanitizedIndexes?: unknown[] }).sanitizedIndexes ?? []

  return indexes.some((index) => {
    const entry = index as { fields?: { path?: string }[]; unique?: boolean }
    if (!entry.unique) return false
    const on = (entry.fields ?? []).map((f) => f.path ?? '')
    // A subset of what was asked for, and nothing outside it: adding a column
    // to a unique index only ever permits more rows.
    return on.length > 0 && on.every((path) => paths.includes(path))
  })
}

/**
 * What a row on D1 can carry, which is half of what the column limit suggests.
 *
 * Cloudflare documents two limits and only one of them is the binding one: a
 * table may hold 100 columns, and a query may bind 100 parameters. Payload's
 * update is an upsert — `insert … on conflict do update set …` — and it passes
 * the SAME row to both halves, so an update binds every column twice.
 *
 * IT IS THE UPDATE, NOT THE WRITE. Measured rather than reasoned, and the
 * measurement corrected this: building both statements with the adapter's own
 * drizzle and counting placeholders gives `columns` for a create and
 * `2 × columns` for an update. A media collection at seven image sizes — six
 * columns each, plus seventeen base — is 59 columns, so a create binds 59 and
 * succeeds while an update binds 118 and fails with `D1_ERROR: too many SQL
 * variables`, naming neither the collection nor the limit.
 *
 * Which is precisely why it hides. An upload lands; the row exists; the
 * library looks correct. What fails is everything that writes a row back —
 * regenerating image sizes, editing a caption, a hook that stamps a field
 * after upload — and on a Worker with no image processing the first update may
 * be weeks away. The migration meanwhile generates all fifty-nine columns
 * without complaint.
 *
 * This package makes it worse by one column: `mediaPlugin` adds `contentHash`,
 * which is two more parameters. Harmless at four image sizes and decisive at
 * five, where a host sits at 94 and installing this package takes it to 96.
 * Saying so at boot is the only moment it can be said usefully.
 */
export const D1_BOUND_PARAMETERS = 100
/** An update binds each column twice; a create binds it once. The update is the ceiling. */
const BOUND_PER_COLUMN = 2
export const D1_COLUMN_BUDGET = Math.floor(D1_BOUND_PARAMETERS / BOUND_PER_COLUMN)

/**
 * The columns a collection's row actually has, from the adapter's own table.
 *
 * Counted from the generated table rather than from the field list, because
 * the two differ exactly where it matters: one upload size is one field and
 * six columns. Undefined where the adapter exposes no table, which is not a
 * fault — it is a host this question cannot be asked of.
 */
const columnCount = (payload: Payload, collection: string): number | undefined => {
  const tables = (payload.db as { tables?: Record<string, object> } | undefined)?.tables
  const table = tables?.[collection]
  return table ? Object.keys(table).length : undefined
}

/** True only for D1, whose ceiling this is. Plain SQLite allows 32,766. */
const isD1 = (payload: Payload): boolean =>
  /d1/i.test((payload.db as { name?: string } | undefined)?.name ?? '')

/**
 * Every requirement, with whether this host meets it. Reports all of them
 * rather than stopping at the first, so one boot names the whole gap.
 */
export function verifySchema(payload: Payload): SchemaFinding[] {
  const findings: SchemaFinding[] = []

  for (const [collection, path] of Object.entries(TENANT_PATH)) {
    if (path === null) continue
    // Not every host serves every collection; absent is not misconfigured.
    if (!payload.collections?.[collection]) continue

    // The same resolution every read uses, so this cannot pass while a read
    // fails — which is what happened when each answered the question its own
    // way and only the read was ever run.
    const satisfied = tenantFieldOf(payload, collection) !== null
    // 'tenants.tenant' is reached through the array field its first part names.
    const root = path.split('.')[0]!
    findings.push({
      collection,
      reason: satisfied
        ? `confined on "${path}"`
        : `TENANT_PATH says "${path}" but ${collection} has no field "${root}" — reads would filter on a field that is not there. Correct TENANT_PATH, or add the field.`,
      requirement: `a tenant field "${path}"`,
      satisfied,
    })
  }

  if (payload.collections?.['media']) {
    const canReference = editorCanReferenceMedia(payload)

    if (canReference !== undefined) {
      findings.push({
        collection: 'media',
        reason: canReference
          ? 'the editor can place an upload'
          : 'this deployment has a media library and the editor has no upload feature, so nothing can reference it — an image becomes literal markdown and an upload node would not validate. If the editor’s features are set as an explicit list, it replaced the defaults rather than extending them.',
        requirement: 'an editor that can reference the media library',
        satisfied: canReference,
      })
    }
  }

  if (payload.collections?.['random-selections']) {
    for (const paths of [['tenant', 'seq'], ['chainHash']]) {
      const satisfied = hasUniqueIndexOn(payload, 'random-selections', paths)
      findings.push({
        collection: 'random-selections',
        reason: satisfied
          ? `unique on (${paths.join(', ')})`
          : `no unique index on (${paths.join(', ')}) — two draws that race read the same head and both insert, forking the chain silently. Every verification afterwards passes on a forked trail.`,
        requirement: `a unique index on (${paths.join(', ')})`,
        satisfied,
      })
    }
  }

  /**
   * THE ACCESS TRAIL LIVES IN PAYLOAD'S VERSION HISTORY, which has a retention
   * setting, and a truncating audit trail is worse than an absent one: it
   * answers an inspection with a confident, incomplete account.
   *
   * `maxPerDoc` defaults to 100 in Payload. A head teacher's account crossing
   * a hundred edits — a name, a photograph, a class, a phone number — silently
   * drops the oldest, and the oldest is where the grant that matters usually
   * is. Article 30 of Regulation (EU) 2016/679 requires the record be KEPT, so
   * the only admissible setting is unlimited, which Payload spells 0.
   */
  if (payload.collections?.['users']) {
    const versions = (payload.collections['users'].config as { versions?: false | { maxPerDoc?: number } }).versions
    const enabled = versions !== undefined && versions !== false
    const max = enabled ? (versions as { maxPerDoc?: number }).maxPerDoc : undefined
    const satisfied = enabled && (max === 0 || max === undefined ? max === 0 : false)

    findings.push({
      collection: 'users',
      reason: !enabled
        ? 'versions are off on users, so a role change leaves no history — the access trail is derived from it, and there is nothing to derive from'
        : max === 0
          ? 'versions kept without limit — the access trail can be read back to the account\'s first recorded state'
          : `versions keep at most ${String(max)} per document, so the oldest changes are dropped as an account is edited. Article 30 requires the record be kept: set versions.maxPerDoc to 0 on users.`,
      requirement: 'users keeps unlimited versions (versions.maxPerDoc = 0)',
      satisfied,
    })
  }

  if (isD1(payload)) {
    // Only the collections this package ships or adds a field to. A host's own
    // collection over the budget is a fault this package did not cause and
    // cannot fix, and failing a deployment over it would be answering a
    // question nobody asked here.
    for (const collection of [...Object.keys(TENANT_PATH), 'media']) {
      if (!payload.collections?.[collection]) continue

      const columns = columnCount(payload, collection)
      if (columns === undefined) continue

      const bound = columns * BOUND_PER_COLUMN
      const satisfied = bound <= D1_BOUND_PARAMETERS

      findings.push({
        collection,
        reason: satisfied
          ? `${columns} columns bind ${bound} of D1's ${D1_BOUND_PARAMETERS} parameters — ${D1_COLUMN_BUDGET - columns} column(s) of headroom`
          : `${columns} columns bind ${bound} parameters on an update and D1 allows ${D1_BOUND_PARAMETERS}, because an update binds every column twice — once to insert, once for "do update set". Creates still bind ${columns} and succeed, which is what makes this hide: rows arrive, and every write BACK to one fails with "too many SQL variables", naming neither the collection nor the limit. On an upload collection each image size costs six columns: removing ${Math.ceil((bound - D1_BOUND_PARAMETERS) / (BOUND_PER_COLUMN * 6))} of them clears it.`,
        requirement: `at most ${D1_COLUMN_BUDGET} columns on D1`,
        satisfied,
      })
    }
  }

  return findings
}

/**
 * A media library nothing can reference.
 *
 * Reported by a host that hit it: its `defaultLexical` replaced Payload's
 * feature set with an explicit list rather than extending it, so `UploadFeature`
 * — one of the defaults — was simply absent. The editor then offered no way to
 * place an image, and an upload node would not have validated if anything had
 * written one. Four hundred and nineteen images sat in pages as literal
 * markdown downstream of that, and nothing anywhere said why.
 *
 * So: if this deployment has a media library, the editor must be able to
 * reference it. Checked only when the feature map can actually be read — a
 * host whose editor is shaped differently is not reported as broken on a
 * structure this cannot see.
 */
const editorCanReferenceMedia = (payload: Payload): boolean | undefined => {
  const editor = (payload.config as { editor?: Record<string, unknown> } | undefined)?.editor
  const resolved = (
    editor?.editorConfig as { resolvedFeatureMap?: Map<string, unknown> } | undefined
  )?.resolvedFeatureMap

  if (!resolved || typeof resolved.keys !== 'function') return undefined

  return [...resolved.keys()].some((key) => key.toLowerCase().includes('upload'))
}

export class SchemaRequirementError extends Error {
  readonly findings: SchemaFinding[]

  constructor(findings: SchemaFinding[]) {
    super(
      `@uuidna/school: the host schema does not meet ${findings.length} requirement(s) this package's guarantees depend on:\n` +
        findings.map((f) => `  - ${f.collection}: ${f.reason}`).join('\n'),
    )
    this.name = 'SchemaRequirementError'
    this.findings = findings
  }
}

/**
 * Call at boot. Fails the deployment rather than the audit: a school that will
 * not start is recoverable, a trail that forked six months ago is not.
 */
export function assertSchema(payload: Payload): void {
  const unmet = verifySchema(payload).filter((finding) => !finding.satisfied)
  if (unmet.length) throw new SchemaRequirementError(unmet)
}
