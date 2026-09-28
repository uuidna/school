import type { Payload, PayloadRequest, Where } from 'payload'

import { andWhere, tenantWhere } from './scope.js'

/**
 * Reads a collection to the end.
 *
 * Every `limit:` in an audit path is a silent floor: a chain verified to ten
 * thousand links reports *intact* while ignoring the rest, a seal of the first
 * thousand receipts reports success while leaving the others unsealed, a
 * statutory check over five hundred documents reports a published act as
 * missing. Each of those is a wrong answer that looks right, which is worse
 * than an error.
 *
 * So nothing that has to be correct guesses a ceiling. This pages until the
 * collection is exhausted and returns everything, and the caller states no
 * number at all.
 *
 * The one bound kept is `maxPages`, which exists to stop a genuine fault — a
 * query that never advances — from looping forever. Reaching it throws rather
 * than returning a short answer, because a truncated audit must never be
 * mistaken for a complete one.
 *
 * The same rule governs *whose* rows these are. Given a `req`, the read is
 * confined to that request's school; a report spanning two schools is the same
 * class of wrong-but-plausible answer as one that stops at a thousand rows.
 *
 * **Tenant confinement cannot be switched off.** It used to share a flag with
 * access control, so every caller that legitimately needed to read past a
 * user's permissions — building an inclusion proof needs the whole leaf set —
 * lost the school filter too, and had to write one by hand. Two of them did,
 * each hardcoding the field name that `TENANT_PATH` is supposed to be the only
 * statement of. A protection you have to remember to re-apply is not a
 * protection; it is a crack with a comment next to it.
 *
 * So the two are separate now. `overrideAccess` skips what a *user* may see.
 * Nothing skips which *school* the rows belong to: that is derived from
 * `TENANT_PATH` on every read, and a collection that is deliberately global
 * says so there, in one place, rather than at each call site.
 */

export type FindAllArgs = {
  collection: string
  depth?: number
  /**
   * Rows per request. Tuned for D1's response size, not for correctness.
   *
   * THE TRAP IS NOT THIS NUMBER, IT IS `pagination: false` — one line away in the same Payload API, and it is
   * what actually breaks. That option asks for every row in ONE query and takes a site's build down with
   * `D1_ERROR: too many SQL variables`; paging is the cure precisely by being its opposite.
   *
   * 500 was suspected unsafe because D1 also caps BOUND PARAMETERS at 100, and a collection with array fields
   * looked likely to exceed it. Measured on a live deployment rather than reasoned about: 254 documents with
   * nested-docs breadcrumbs and 89 pages carrying layout blocks both page through at 500 without complaint.
   * The parameter cap applies per statement, and paging keeps each statement small — which is the whole point.
   * (Measured by the pgtbankya deployment, 2026-09-25.)
   */
  pageSize?: number
  /**
   * Read past what this user may see — for a hook establishing state, or a
   * proof that needs the whole set. It does **not** widen the read beyond this
   * school; nothing does.
   */
  overrideAccess?: boolean
  req?: PayloadRequest
  sort?: string
  where?: Where
}

export async function findAll<T = Record<string, unknown>>(
  payload: Payload,
  { collection, depth = 0, overrideAccess = false, pageSize = 500, req, sort, where }: FindAllArgs,
): Promise<T[]> {
  const maxPages = 10_000
  const all: T[] = []

  // Always. Throws rather than returning another school's rows when the host
  // matched no school and more than one exists.
  const scope = req ? await tenantWhere(payload, req, collection) : undefined
  const filter = andWhere(scope, where)

  for (let page = 1; page <= maxPages; page++) {
    const result = await payload.find({
      collection: collection as never,
      depth,
      limit: pageSize,
      overrideAccess,
      page,
      req,
      ...(sort ? { sort } : {}),
      ...(filter ? { where: filter } : {}),
    })

    all.push(...(result.docs as T[]))

    if (!result.hasNextPage) return all
  }

  throw new Error(
    `findAll(${collection}) exceeded ${maxPages} pages — refusing to return a partial result`,
  )
}

/**
 * Counts without reading. Used where a report needs the size of something it
 * deliberately does not list in full.
 */
export async function countAll(
  payload: Payload,
  collection: string,
  req?: PayloadRequest,
  overrideAccess = false,
): Promise<number> {
  const scope = req ? await tenantWhere(payload, req, collection) : undefined

  const { totalDocs } = await payload.count({
    collection: collection as never,
    overrideAccess,
    req,
    ...(scope ? { where: scope } : {}),
  })
  return totalDocs
}
