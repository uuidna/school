import type { CollectionBeforeChangeHook, Payload, PayloadRequest } from 'payload'

import { slugify } from './slug.js'

/**
 * Host-resolved tenancy.
 *
 * The multi-tenant plugin validates `tenant` as required and resolves it in the
 * admin UI from a cookie the tenant selector sets. On a fresh install there is
 * no tenant and no cookie, so creating the very first user fails with a
 * required-field error and the instance cannot be bootstrapped at all.
 *
 * The host answers it: a school reaches its own CMS on its own domain, so the
 * request's `Host` header names the tenant. If none matches and none exists,
 * the first tenant is created from that host — which is exactly the case the
 * first-user form is in.
 */

/**
 * The host this request is for.
 *
 * Reads to the school are confined by the tenant this resolves, so the host is
 * an authorisation input, not a hint. `x-forwarded-host` is set by nobody in
 * front of a Worker — Cloudflare does not add it — which means a client can
 * send it and choose which school's records it is answered about. It is
 * therefore ignored unless a deployment that really does sit behind a proxy
 * opts in with `SCHOOL_TRUST_FORWARDED_HOST=1`, and even then `host` is the
 * fallback rather than the other way round.
 */
export const hostOf = (req: PayloadRequest): string | undefined => {
  const trustForwarded = process.env.SCHOOL_TRUST_FORWARDED_HOST === '1'
  const forwarded = trustForwarded ? req.headers.get('x-forwarded-host') : null
  // A proxy may append; the first entry is the original client-facing host.
  const host = (forwarded?.split(',')[0] ?? req.headers.get('host')) ?? undefined
  // Strip the port: localhost:3000 and localhost are the same tenant.
  return host?.split(':')[0]?.trim().toLowerCase()
}

/** The tenant for this request's host, or the sole tenant, or nothing. */
export async function resolveTenantFromHost(
  payload: Payload,
  req: PayloadRequest,
): Promise<null | { id: number | string }> {
  const host = hostOf(req)

  if (host) {
    const byDomain = await payload.find({
      collection: 'tenants',
      depth: 0,
      limit: 1,
      // Deliberate: resolving which school this is precedes knowing who the
      // caller is, and gates nothing on its own.
      overrideAccess: true,
      req,
      where: { domain: { equals: host } },
    })
    if (byDomain.docs[0]) return byDomain.docs[0]
  }

  // A single-school install has exactly one tenant; use it rather than failing
  // because nobody filled in a domain.
  const any = await payload.find({ collection: 'tenants', depth: 0, limit: 2, overrideAccess: true, req })
  return any.totalDocs === 1 ? (any.docs[0] ?? null) : null
}

/**
 * Creates the first tenant from the request host when none exists.
 * Only ever fires on an empty instance — after that, tenants are made by hand.
 */
export async function ensureFirstTenant(payload: Payload, req: PayloadRequest) {
  const existing = await resolveTenantFromHost(payload, req)
  if (existing) return existing

  const { totalDocs } = await payload.count({ collection: 'tenants', overrideAccess: true, req })
  if (totalDocs > 0) return null

  const host = hostOf(req) ?? 'localhost'

  return payload.create({
    collection: 'tenants',
    // The first user does not exist yet; this is the call that makes their
    // school. It only ever runs when the register is empty.
    overrideAccess: true,
    data: {
      domain: host,
      name: host,
      slug: slugify(host, 'romanise') || 'default',
    },
    req,
  })
}

/**
 * Gives a new user the tenant of the host they signed up on, bootstrapping that
 * tenant if this is the first user on a fresh instance.
 */
export const assignTenantFromHost: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create') return data

  const assigned = data?.tenants as { tenant?: unknown }[] | undefined
  if (Array.isArray(assigned) && assigned.length) return data

  const tenant = await ensureFirstTenant(req.payload, req)
  if (!tenant) return data

  return { ...data, tenants: [{ tenant: tenant.id }] }
}
