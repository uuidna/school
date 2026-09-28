import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Config } from 'payload'

import { verifySchema } from '../../payload/schema.js'
import { fairSelectionPlugin } from '../fair/index.js'
import { rbacPlugin, stampAccessChange } from './index.js'

// THE REASON WAS BEING DROPPED. Two tools asked a registrar why they were
// granting a role, put it in req.context, and nothing read it. art. 5(2) asks
// the controller to demonstrate *why* a right was given; the package collected
// the why and discarded it.
//
// IT IS NO LONGER A ROW. `access-log` held eight fields and six restated a
// document Payload already versions, so the trail is the version history and
// the two facts a version cannot supply — who changed it and why — are stamped
// onto the document BEFORE the save, which is the only moment the snapshot can
// still be affected. These watch the stamp; versions.test.ts watches the
// reading back.

const stamped = (
  previousRole: string | undefined,
  nextRole: string | undefined,
  context: Record<string, unknown> = {},
  operation: 'create' | 'update' = 'update',
  user: unknown = { email: 'head@school.bg', id: 1 },
) =>
  stampAccessChange({
    collection: {} as never,
    context: context as never,
    data: { email: 'teacher@school.bg', role: nextRole },
    operation,
    originalDoc: { email: 'teacher@school.bg', role: previousRole },
    req: { context, user } as never,
  } as never) as Record<string, unknown>

test('a role change is stamped with the reason the caller stated', () => {
  const data = stamped('teacher', 'registrar', { accessReason: 'covering admissions' })
  assert.equal(data.accessReason, 'covering admissions')
  assert.equal(data.accessChangedBy, 'head@school.bg')
})

test('a change made with no reason is still stamped, as one with no reason', () => {
  // Refusing it would hide the one thing an inspection looks for.
  const data = stamped('teacher', 'admin')
  assert.equal(data.accessReason, null)
  assert.equal(data.accessChangedBy, 'head@school.bg')
})

test('a revocation is stamped like any other change — the verdict is read later', () => {
  const data = stamped('teacher', 'student', { accessReason: 'left the school' })
  assert.equal(data.accessReason, 'left the school')
})

test('an update that does not change the role stamps nothing', () => {
  const data = stamped('teacher', 'teacher', { accessReason: 'should not appear' })
  assert.equal(data.accessReason, undefined)
  assert.equal(data.accessChangedBy, undefined)
})

test('creating an account is not a change of access', () => {
  const data = stamped(undefined, 'teacher', { accessReason: 'should not appear' }, 'create')
  assert.equal(data.accessReason, undefined)
})

test('a change with no signed-in actor is stamped "system", never blank', () => {
  const data = stamped('teacher', 'admin', {}, 'update', null)
  assert.equal(data.accessChangedBy, 'system')
})

test('the plugin keeps unlimited versions on users — the trail cannot truncate', () => {
  const config = { collections: [{ fields: [], slug: 'users' }] } as unknown as Config
  const out = rbacPlugin()(config) as Config
  const users = (out.collections ?? []).find((c) => c.slug === 'users')!
  assert.deepEqual((users as { versions?: unknown }).versions, { maxPerDoc: 0 })
})

test('the plugin adds the two fields a version cannot supply', () => {
  const config = { collections: [{ fields: [], slug: 'users' }] } as unknown as Config
  const out = rbacPlugin()(config) as Config
  const users = (out.collections ?? []).find((c) => c.slug === 'users')!
  const names = (users.fields ?? []).map((f) => (f as { name?: string }).name)
  assert.ok(names.includes('accessReason'))
  assert.ok(names.includes('accessChangedBy'))
})

test('no access-log collection is shipped any more', () => {
  const config = { collections: [{ fields: [], slug: 'users' }] } as unknown as Config
  const out = rbacPlugin()(config) as Config
  assert.equal((out.collections ?? []).some((c) => c.slug === 'access-log'), false)
})

// SAME HOOK BOTH WAYS. The admin panel sets no req.context, so a change made
// there is stamped with an actor and no reason, and a change made through MCP
// carries the reason the tool demanded. Both produce a version either way —
// the trail does not depend on which door was used.
test('a change through the admin panel is stamped like one through MCP', () => {
  const viaPanel = stamped('student', 'registrar')
  const viaMcp = stamped('student', 'registrar', { accessReason: 'covering the office' })

  assert.equal(viaPanel.accessChangedBy, 'head@school.bg')
  assert.equal(viaPanel.accessReason, null)
  assert.equal(viaMcp.accessReason, 'covering the office')
})

// A REGISTRAR WHO MAY CHANGE A ROLE BUT NOT WRITE THE LOG would once have
// changed it unrecorded — the old hook wrote with overrideAccess for exactly
// that reason. It cannot happen now: the stamp is part of the document being
// saved, so there is no second write to be refused.
test('the trail cannot be separated from the change that caused it', () => {
  const data = stamped('student', 'teacher', { accessReason: 'appointed' }, 'update', { email: 'registrar@school.bg', id: 9 })
  assert.equal(data.accessChangedBy, 'registrar@school.bg')
  assert.equal(data.accessReason, 'appointed')
  assert.equal(data.role, 'teacher', 'the stamp travels WITH the change, not beside it')
})

// THE HOOK MOVED FROM afterChange TO beforeChange, because the stamp has to be
// part of the document being saved rather than a row written after it. These
// hold the attachment and — the thing that broke a host once — that an existing
// hook on users is extended, never replaced.
test('the plugin attaches its hook to the users collection', () => {
  const config = { collections: [{ fields: [], slug: 'users' }] } as unknown as Config
  const out = rbacPlugin()(config) as Config
  const users = (out.collections ?? []).find((c) => c.slug === 'users')!
  assert.equal(users.hooks?.beforeChange?.length, 1)
})

test('an existing hook on users is kept, not replaced', () => {
  const mine = () => ({})
  const config = {
    collections: [{ fields: [], hooks: { beforeChange: [mine] }, slug: 'users' }],
  } as unknown as Config
  const out = rbacPlugin()(config) as Config
  const users = (out.collections ?? []).find((c) => c.slug === 'users')!
  assert.equal(users.hooks?.beforeChange?.length, 2)
  assert.equal(users.hooks?.beforeChange?.[0], mine, 'the host\'s own hook still runs first')
})

test('a collection that is not users is left exactly as it was', () => {
  const pages = { fields: [], slug: 'pages' }
  const out = rbacPlugin()({ collections: [pages] } as unknown as Config) as Config
  assert.equal((out.collections ?? []).find((c) => c.slug === 'pages'), pages)
})

test('the fair plugin ships the unique index the chain guarantee depends on', () => {
  const config = fairSelectionPlugin()({ collections: [] } as unknown as Config) as Config
  const selections = config.collections!.find((c) => c.slug === 'random-selections')!

  const compound = selections.indexes!.find(
    (index) => index.fields.includes('tenant') && index.fields.includes('seq'),
  )
  assert.equal(compound!.unique, true, 'two racing draws could fork the chain')

  const chainHash = selections.fields.find((f) => 'name' in f && f.name === 'chainHash')!
  assert.equal((chainHash as { unique?: boolean }).unique, true)
})

test('a single-school instance gets the same guarantee on seq alone', () => {
  const config = fairSelectionPlugin({ multiTenant: false })({ collections: [] } as unknown as Config) as Config
  const selections = config.collections!.find((c) => c.slug === 'random-selections')!

  const seq = selections.fields.find((f) => 'name' in f && f.name === 'seq')!
  assert.equal((seq as { unique?: boolean }).unique, true)
})

test('nothing may delete or amend a receipt', () => {
  const config = fairSelectionPlugin()({ collections: [] } as unknown as Config) as Config
  const selections = config.collections!.find((c) => c.slug === 'random-selections')!

  assert.equal(selections.access!.delete!({} as never), false)
  assert.equal(selections.access!.update!({} as never), false)
})

test('a host built from these plugins satisfies the schema guard', () => {
  // The audit's finding, closed: the requirement is now met by construction.
  const config = fairSelectionPlugin()({ collections: [] } as unknown as Config) as Config
  const selections = config.collections!.find((c) => c.slug === 'random-selections')!

  const payload = {
    collections: {
      'random-selections': {
        config: {
          flattenedFields: selections.fields.filter((f) => 'name' in f),
          sanitizedIndexes: selections.indexes!.map((index) => ({
            fields: index.fields.map((path) => ({ path })),
            unique: index.unique,
          })),
        },
      },
    },
  }

  assert.deepEqual(verifySchema(payload as never).filter((f) => !f.satisfied), [])
})
