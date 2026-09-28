import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { assignTenantFromHost, ensureFirstTenant, hostOf, resolveTenantFromHost } from './tenancy.js'

// THE HOST DECIDES WHICH SCHOOL'S RECORDS ANSWER, so it is an authorisation
// input and not a hint. This module had no tests at all, including the
// hardening that stopped x-forwarded-host being trusted.

const req = (headers: Record<string, string>) =>
  ({ headers: new Headers(headers) }) as unknown as PayloadRequest

const payloadWith = (tenants: Record<string, unknown>[]) => {
  const created: Record<string, unknown>[] = []
  return {
    created,
    payload: {
      count: async () => ({ totalDocs: tenants.length }),
      create: async (a: { data: Record<string, unknown> }) => {
        created.push(a.data)
        return { id: tenants.length + 1, ...a.data }
      },
      find: async (a: { where?: { domain?: { equals?: string } } }) => {
        const docs = a.where?.domain
          ? tenants.filter((t) => t.domain === a.where!.domain!.equals)
          : tenants
        return { docs, hasNextPage: false, totalDocs: a.where ? docs.length : tenants.length }
      },
    } as never,
  }
}

test('the port is not part of the host', () => {
  assert.equal(hostOf(req({ host: 'localhost:3000' })), 'localhost')
  assert.equal(hostOf(req({ host: 'School.BG' })), 'school.bg')
})

test('x-forwarded-host is ignored unless a deployment opts in', () => {
  // Nothing in front of a Worker sets it, so a client can — and the host
  // chooses which school's records answer.
  const spoofed = req({ host: 'school.bg', 'x-forwarded-host': 'other-school.bg' })

  delete process.env.SCHOOL_TRUST_FORWARDED_HOST
  assert.equal(hostOf(spoofed), 'school.bg')
})

test('a deployment behind a real proxy may opt in', () => {
  process.env.SCHOOL_TRUST_FORWARDED_HOST = '1'
  try {
    assert.equal(
      hostOf(req({ host: 'internal', 'x-forwarded-host': 'school.bg' })),
      'school.bg',
    )
    // A proxy may append; the first entry is the client-facing host.
    assert.equal(
      hostOf(req({ host: 'internal', 'x-forwarded-host': 'school.bg, proxy.internal' })),
      'school.bg',
    )
  } finally {
    delete process.env.SCHOOL_TRUST_FORWARDED_HOST
  }
})

test('only the literal 1 opts in', () => {
  process.env.SCHOOL_TRUST_FORWARDED_HOST = 'true'
  try {
    assert.equal(hostOf(req({ host: 'school.bg', 'x-forwarded-host': 'other.bg' })), 'school.bg')
  } finally {
    delete process.env.SCHOOL_TRUST_FORWARDED_HOST
  }
})

test('a host matching a school resolves to it', async () => {
  const { payload } = payloadWith([
    { domain: 'a.bg', id: 1 },
    { domain: 'b.bg', id: 2 },
  ])

  const found = await resolveTenantFromHost(payload, req({ host: 'b.bg' }))
  assert.equal(found!.id, 2)
})

test('a single-school install answers whatever the host says', async () => {
  const { payload } = payloadWith([{ domain: 'a.bg', id: 1 }])
  const found = await resolveTenantFromHost(payload, req({ host: 'anything.example' }))

  assert.equal(found!.id, 1)
})

test('an unmatched host on a multi-school install resolves to nothing', async () => {
  // Not to the first one. Guessing here is how a report describes the wrong
  // school; the callers turn this into a refusal.
  const { payload } = payloadWith([
    { domain: 'a.bg', id: 1 },
    { domain: 'b.bg', id: 2 },
  ])

  assert.equal(await resolveTenantFromHost(payload, req({ host: 'c.bg' })), null)
})

test('the first school is created from the host of the first visitor', async () => {
  const { created, payload } = payloadWith([])
  const made = await ensureFirstTenant(payload, req({ host: 'new-school.bg' }))

  assert.equal(created.length, 1)
  assert.equal(created[0]!.domain, 'new-school.bg')
  assert.equal(created[0]!.slug, 'new-school-bg')
  assert.ok(made)
})

test('a second school is never created from a host', async () => {
  // Bootstrap only. Otherwise any unmatched host would mint a school.
  const { created, payload } = payloadWith([
    { domain: 'a.bg', id: 1 },
    { domain: 'b.bg', id: 2 },
  ])

  assert.equal(await ensureFirstTenant(payload, req({ host: 'c.bg' })), null)
  assert.deepEqual(created, [])
})

test('a new user is given the school they signed up on', async () => {
  const { payload } = payloadWith([{ domain: 'a.bg', id: 1 }])
  const out = await assignTenantFromHost({
    collection: {} as never,
    context: {} as never,
    data: { email: 'x@a.bg' },
    operation: 'create',
    req: { headers: new Headers({ host: 'a.bg' }), payload } as never,
  } as never)

  assert.deepEqual((out as { tenants: unknown }).tenants, [{ tenant: 1 }])
})

test('a user who already has a school keeps it', async () => {
  const { payload } = payloadWith([{ domain: 'a.bg', id: 1 }])
  const data = { email: 'x@a.bg', tenants: [{ tenant: 9 }] }
  const out = await assignTenantFromHost({
    collection: {} as never,
    context: {} as never,
    data,
    operation: 'create',
    req: { headers: new Headers({ host: 'a.bg' }), payload } as never,
  } as never)

  assert.deepEqual((out as { tenants: unknown }).tenants, [{ tenant: 9 }])
})

test('an update does not reassign anyone', async () => {
  const { payload } = payloadWith([{ domain: 'a.bg', id: 1 }])
  const data = { email: 'x@a.bg' }
  const out = await assignTenantFromHost({
    collection: {} as never,
    context: {} as never,
    data,
    operation: 'update',
    req: { headers: new Headers({ host: 'a.bg' }), payload } as never,
  } as never)

  assert.equal((out as { tenants?: unknown }).tenants, undefined)
})
