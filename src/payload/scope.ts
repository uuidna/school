import type { FlattenedField, Payload, PayloadRequest, Where } from 'payload'

import { resolveTenantFromHost } from '../tenancy.js'

/**
 * Tenant scoping, and the access control that was never running.
 *
 * Two defects met here, and each made the other invisible.
 *
 * Payload's Local API defaults `overrideAccess` to **true**. Passing `req`
 * supplies the user and the transaction but does not turn access control on, so
 * every tool in this package read with collection access control disabled — the
 * README's "authorisation is doubled" was a single gate, the tool's own
 * `allowedRoles`. Access control is now requested explicitly at every call.
 *
 * With it off, nothing scoped a read to one school either. On a deployment
 * serving two schools, `school_legal_publication_status` could answer
 * *compliant* because the other school had published the document, and the
 * access review listed both schools' staff. A compliance tool that reports on
 * the wrong school is worse than one that refuses to answer.
 *
 * So reads scope to the request's tenant, and this module **fails closed**: if
 * the tenant cannot be determined and the instance holds more than one, the
 * call throws rather than quietly spanning schools. That is the same rule
 * `findAll` already applies to pagination — a wrong answer that looks right is
 * worse than an error.
 *
 * `TENANT_PATH` is the one assumption here that this package cannot make on its
 * own, because it does not define these collections; they live in the host app.
 * So it is not trusted: every path is checked against the host's actual schema
 * before it is used, by `tenantFieldOf` below, which `verifySchema` also asks —
 * so a mismatch cannot pass the boot check and fail the read.
 *
 * A path this table declares and the host does not have is not a filter — it is
 * a query against a column that is not there, and Payload answers it with
 * *"The following path cannot be queried: tenant"*, which names neither the
 * collection nor the cause. That is what `school_list_content` did on a host
 * that scopes its registers by tenant and its pages by deployment.
 */

/** Field path holding the tenant, per collection. `null` = deliberately global. */
export const TENANT_PATH: Record<string, null | string> = {
  documents: 'tenant',
  // A school's own media library, where a migration's images land.
  media: 'tenant',
  // Term dates, closures and deadlines a school keeps itself.
  'school-calendar': 'tenant',
  pages: 'tenant',
  posts: 'tenant',
  'random-selections': 'tenant',
  'receipt-roots': 'tenant',
  // Users belong to tenants through an array field, per `assignTenantFromHost`.
  users: 'tenants.tenant',
  // The tenant register itself is how a tenant is found; scoping it is circular.
  tenants: null,
  // A programme published by the Commission is the same programme for every
  // school here. Scoping it would give each school its own copy of a public
  // catalogue, and copies of a catalogue drift.
  'financing-programmes': null,
  // An act approved for a country is the same act for every school in it.
  'national-catalogues': null,
}

/**
 * The field this host records the tenant in for a collection, or `null` when it
 * records none.
 *
 * `TENANT_PATH` states the policy — confined, or deliberately global. Whether
 * the host's schema actually carries the field is a different question, and
 * asking it is the only way to tell a filter from a query against a column that
 * is not there. `verifySchema` reports the mismatch at boot; this is what both
 * it and every read resolve the field through, so there is one implementation
 * of the question and not two.
 */
export function tenantFieldOf(payload: Payload, collection: string): null | string {
  const declared = TENANT_PATH[collection]
  if (declared === null || declared === undefined) return null

  // Deliberately not memoised: the answer belongs to a Payload instance, not to
  // a collection name, and a cache keyed on the name alone answers for whichever
  // schema asked first. Scanning a sanitised field list is a few comparisons.
  // 'tenants.tenant' is reached through the array field its first part names.
  const root = declared.split('.')[0]!
  const fields: FlattenedField[] | undefined =
    payload.collections?.[collection]?.config.flattenedFields

  return fields?.some((field) => (field as { name?: string }).name === root) ? declared : null
}

export class TenantScopeError extends Error {
  constructor(collection: string, noTenantField = false) {
    super(
      `Refusing to read ${collection} without a tenant: ` +
        (noTenantField
          ? `this deployment records no tenant on it — TENANT_PATH declares "${TENANT_PATH[collection]}", which the collection does not have — and the instance holds more than one school. Add the field, or set TENANT_PATH["${collection}"] = null if this host separates schools by database.`
          : `the request host matched no school and this instance holds more than one.`) +
        ` An unscoped answer would describe the wrong school.`,
    )
    this.name = 'TenantScopeError'
  }
}

/**
 * The tenant for this request, resolved once and memoised on the request.
 *
 * Reports call several tools, and each tool several collections; resolving the
 * host on every read would be a query per collection for an answer that cannot
 * change within one request.
 */
const TENANT_CACHE = new WeakMap<object, null | { id: number | string }>()

export async function tenantOf(
  payload: Payload,
  req: PayloadRequest,
): Promise<null | { id: number | string }> {
  if (TENANT_CACHE.has(req)) return TENANT_CACHE.get(req) ?? null

  // Bootstrap reads the tenant register itself, before any user exists.
  const tenant = await resolveTenantFromHost(payload, req)
  TENANT_CACHE.set(req, tenant)
  return tenant
}

/**
 * The `where` that confines a read to one school, or `undefined` when the
 * collection is deliberately global. Throws when the tenant is unknown and
 * more than one school could be meant.
 */
export async function tenantWhere(
  payload: Payload,
  req: PayloadRequest,
  collection: string,
): Promise<undefined | Where> {
  if (TENANT_PATH[collection] === null) return undefined

  // Only a path the host's schema actually has can confine a read. An absent
  // one is not a weaker filter than a present one; it is an error, and the
  // count below decides whether it is one that matters here.
  const path = tenantFieldOf(payload, collection)

  if (path) {
    const tenant = await tenantOf(payload, req)
    if (tenant) return { [path]: { equals: tenant.id } }
  }

  // Either no tenant matched the host, or this deployment does not record one
  // on this collection at all — a school per database rather than a column per
  // row. Both are harmless while there is only one school that could be meant,
  // and a wrong answer on any instance holding more, so both are refused there.
  const { totalDocs } = await payload.count({ collection: 'tenants', overrideAccess: true, req })
  if (totalDocs <= 1) return undefined

  throw new TenantScopeError(collection, path === null)
}

/** Combines the tenant constraint with a caller's own filter. */
export const andWhere = (...clauses: (undefined | Where)[]): undefined | Where => {
  const present = clauses.filter((clause): clause is Where => Boolean(clause))
  if (present.length === 0) return undefined
  return present.length === 1 ? present[0] : { and: present }
}

/**
 * The tenant field to stamp on a new row, so that what a tool writes is what
 * the scoped reads can later find. A row created without it is invisible to
 * every report on the school that created it.
 */
export async function tenantStamp(
  payload: Payload,
  req: PayloadRequest,
  collection: string,
): Promise<Record<string, number | string>> {
  // Verified, not declared: stamping a field the collection does not have puts
  // a key Payload will reject on the row, which is the write-side of the same
  // fault. Null is global; a dotted path is a relationship array the caller
  // must build.
  const path = tenantFieldOf(payload, collection)
  if (!path || path.includes('.')) return {}

  const tenant = await tenantOf(payload, req)
  return tenant ? { [path]: tenant.id } : {}
}
