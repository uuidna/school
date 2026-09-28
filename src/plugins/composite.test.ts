import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Config } from 'payload'

import { schoolPlugin } from './composite.js'

// assertSchema WAS WRITTEN, EXPORTED, TESTED, AND NEVER CALLED. Being callable
// is not being called: on a live deployment it protected nothing. These tests
// are about the wiring, not the guard.

const base = () =>
  ({
    collections: [
      { fields: [], slug: 'tenants' },
      { fields: [], slug: 'users' },
      { fields: [], slug: 'media', upload: true },
    ],
  }) as unknown as Config

const wellFormed = {
  collections: {
    'random-selections': {
      config: {
        flattenedFields: [{ name: 'seq' }, { name: 'tenant' }, { name: 'chainHash', unique: true }],
        sanitizedIndexes: [{ fields: [{ path: 'tenant' }, { path: 'seq' }], unique: true }],
      },
    },
  },
}

test('the schema guard actually runs at boot', async () => {
  const config = (await schoolPlugin()(base())) as Config
  assert.equal(typeof config.onInit, 'function')

  const broken = {
    collections: { 'random-selections': { config: { flattenedFields: [], sanitizedIndexes: [] } } },
  }

  await assert.rejects(async () => {
    await config.onInit!(broken as never)
  }, /does not meet/)
})

test('a host that meets the requirements boots', async () => {
  const config = (await schoolPlugin()(base())) as Config
  // Throws on a bad schema; here it must simply return.
  await config.onInit!(wellFormed as never)
})

test("a host's own onInit still runs", async () => {
  let ran = false
  const withInit = { ...base(), onInit: async () => { ran = true } } as unknown as Config

  const config = (await schoolPlugin()(withInit)) as Config
  await config.onInit!(wellFormed as never)

  assert.equal(ran, true)
})

test('the guard can be declined, but only deliberately', async () => {
  const config = (await schoolPlugin({ verifySchema: false })(base())) as Config
  assert.equal(config.onInit, undefined)
})

test('it brings the collections the guarantees rest on', async () => {
  const config = (await schoolPlugin()(base())) as Config
  const slugs = config.collections!.map((c) => c.slug)

  for (const slug of ['random-selections', 'receipt-roots', 'financing-programmes']) {
    assert.ok(slugs.includes(slug), `${slug} is missing`)
  }
})

test('the media library gets what the ingest tool needs', async () => {
  // school_ingest_images is on by default, and the tool without the schema
  // stores files it cannot deduplicate: the unique contentHash index is what
  // makes a second copy impossible rather than merely unlikely.
  const config = (await schoolPlugin()(base())) as Config
  const media = config.collections!.find((c) => c.slug === 'media')!

  const hash = media.fields.find((f) => 'name' in f && f.name === 'contentHash') as
    | undefined
    | { unique?: boolean }

  assert.ok(hash, 'media has no contentHash')
  assert.equal(hash!.unique, true, 'the same bytes could be stored twice')
  assert.ok(media.fields.some((f) => 'name' in f && f.name === 'sourceUrls'))
})

test('a host that keeps its media elsewhere can decline it', async () => {
  const config = (await schoolPlugin({ media: false })(base())) as Config
  const media = config.collections!.find((c) => c.slug === 'media')!

  assert.ok(!media.fields.some((f) => 'name' in f && f.name === 'contentHash'))
})

test('a differently named media collection is reached', async () => {
  const withFiles = {
    collections: [
      { fields: [], slug: 'tenants' },
      { fields: [], slug: 'users' },
      { fields: [], slug: 'files', upload: true },
    ],
  } as unknown as Config

  const config = (await schoolPlugin({ media: { mediaSlug: 'files' } })(withFiles)) as Config
  const files = config.collections!.find((c) => c.slug === 'files')!

  assert.ok(files.fields.some((f) => 'name' in f && f.name === 'contentHash'))
})

test('media is confined to a school like everything else', async () => {
  const config = (await schoolPlugin()(base())) as Config
  const media = config.collections!.find((c) => c.slug === 'media')!

  assert.ok(media.fields.some((f) => 'name' in f && f.name === 'tenant'))
})

test('a host that already scopes its media is not given a second tenant field', async () => {
  const scoped = {
    collections: [
      { fields: [], slug: 'tenants' },
      { fields: [], slug: 'users' },
      { fields: [{ name: 'tenant', type: 'relationship' }], slug: 'media', upload: true },
    ],
  } as unknown as Config

  const config = (await schoolPlugin()(scoped)) as Config
  const media = config.collections!.find((c) => c.slug === 'media')!
  const tenants = media.fields.filter((f) => 'name' in f && f.name === 'tenant')

  assert.equal(tenants.length, 1, 'media has two tenant fields')
})

test('a single-school instance gets no tenant field on media', async () => {
  const config = (await schoolPlugin({ multiTenant: false })(base())) as Config
  const media = config.collections!.find((c) => c.slug === 'media')!

  assert.ok(!media.fields.some((f) => 'name' in f && f.name === 'tenant'))
})

test('each piece can be declined on its own', async () => {
  const config = (await schoolPlugin({ fair: false, financing: false })(base())) as Config
  const slugs = config.collections!.map((c) => c.slug)

  assert.ok(!slugs.includes('random-selections'))
  assert.ok(!slugs.includes('financing-programmes'))
  assert.ok(slugs.includes('school-calendar'), 'declining one piece removed another')
})

test('the MCP endpoints are mounted, and can be left off', async () => {
  const on = (await schoolPlugin()(base())) as Config
  assert.ok(on.endpoints!.some((e) => e.path === '/mcp'))

  const off = (await schoolPlugin({ mcp: false })(base())) as Config
  assert.ok(!(off.endpoints ?? []).some((e) => e.path === '/mcp'))
})

test('the pupil-facing page is mounted by default', async () => {
  // school_researcher_financing was built so a sixteen-year-old applying alone
  // is the case that works, and it was reachable only over MCP — open to the
  // staff who least needed it.
  const config = (await schoolPlugin()(base())) as Config
  const paths = config.endpoints!.map((e) => e.path)

  assert.ok(paths.includes('/school/discover'))
  assert.ok(paths.includes('/school/discover/data'))
})

test('the parent-facing page is mounted by default', async () => {
  // The audience the fairness work is for cannot reach MCP, so the page they
  // can open is not an extra.
  const config = (await schoolPlugin()(base())) as Config
  const paths = config.endpoints!.map((e) => e.path)

  assert.ok(paths.includes('/school/verify'))
  assert.ok(paths.includes('/school/verify/data'))
})

test('the page can be declined, and declining it leaves MCP alone', async () => {
  const config = (await schoolPlugin({ verifyPage: false })(base())) as Config
  const paths = config.endpoints!.map((e) => e.path)

  assert.ok(!paths.includes('/school/verify'))
  assert.ok(paths.includes('/mcp'), 'declining the page removed the MCP surface')
})

test('the page can be mounted elsewhere, and its data follows it', async () => {
  const config = (await schoolPlugin({ verifyPage: { path: '/proverka' } })(base())) as Config
  const paths = config.endpoints!.map((e) => e.path)

  assert.ok(paths.includes('/proverka'))
  assert.ok(paths.includes('/proverka/data'))
})

test('multiTenant passes through to every piece that needs it', async () => {
  const single = (await schoolPlugin({ multiTenant: false })(base())) as Config
  const selections = single.collections!.find((c) => c.slug === 'random-selections')!

  // One school: the anti-fork guarantee falls back to seq alone.
  const seq = selections.fields.find((f) => 'name' in f && f.name === 'seq')!
  assert.equal((seq as { unique?: boolean }).unique, true)
  assert.ok(!selections.fields.some((f) => 'name' in f && f.name === 'tenant'))
})

// PAYLOAD FILLS AN ABSENT ACCESS RULE WITH "IS ANYBODY SIGNED IN".
// `defaults.js` sets create, read, update and delete to
// `({ req: { user } }) => Boolean(user)`, so an operation nobody reasoned
// about is not closed — it is open to every pupil and parent with a password.
// Measured before this existed: financing-programmes, national-catalogues and
// school-calendar declared no rules at all; access-log had no read;
// receipt-roots had no create or read; and random-selections argued carefully
// about three operations and omitted the fourth.

const OPERATIONS = ['create', 'delete', 'read', 'update'] as const

const hostConfig = async () => {
  const host = {
    collections: [
      { fields: [], slug: 'users' },
      { fields: [], slug: 'tenants' },
      { fields: [], slug: 'media', upload: true },
    ],
  }
  return (await schoolPlugin({ verifySchema: false })(host as never)) as {
    collections: { access?: Record<string, unknown>; slug: string }[]
  }
}

test('every collection this package ships states all four access rules', async () => {
  const config = await hostConfig()
  const hosts = new Set(['media', 'tenants', 'users'])

  const gaps: string[] = []
  for (const collection of config.collections) {
    if (hosts.has(collection.slug)) continue
    for (const operation of OPERATIONS) {
      if (typeof collection.access?.[operation] !== 'function') {
        gaps.push(`${collection.slug}.${operation}`)
      }
    }
  }

  assert.deepEqual(
    gaps,
    [],
    'these default to Boolean(req.user) — any signed-in pupil or parent — because nothing declared them',
  )
})

test('no shipped collection lets an ordinary account write to it', async () => {
  // The rules exist; this asks what they answer. A pupil is signed in, so the
  // Payload default would say yes to all four — which is the whole point.
  const config = await hostConfig()
  const hosts = new Set(['media', 'tenants', 'users'])
  const pupil = { req: { user: { class: '12a', email: 'p@x', id: 1, role: 'student' } } }

  const writable: string[] = []
  for (const collection of config.collections) {
    if (hosts.has(collection.slug)) continue
    for (const operation of ['create', 'delete', 'update'] as const) {
      const rule = collection.access?.[operation] as (args: unknown) => unknown
      if (rule(pupil) === true) writable.push(`${collection.slug}.${operation}`)
    }
  }

  assert.deepEqual(writable, [], 'a pupil can write to these through the REST and GraphQL APIs')
})

test('the collections a host already defines are not defined twice', async () => {
  // Two definitions of one slug is not a state Payload can hold, and the
  // host's is the one with the rows in it. schoolPlugin appended
  // unconditionally, so a host with its own random-selections and access-log
  // received ten collections where eight were meant.
  const host = {
    collections: [
      { fields: [{ name: 'seq', type: 'number' }], slug: 'random-selections' },
      { fields: [], slug: 'access-log' },
      { fields: [], slug: 'users' },
    ],
  }

  const config = (await schoolPlugin({ verifySchema: false })(host as never)) as {
    collections: { fields: { name: string }[]; slug: string }[]
  }
  const slugs = config.collections.map((collection) => collection.slug)

  assert.deepEqual(
    slugs.filter((slug, i) => slugs.indexOf(slug) !== i),
    [],
    'these slugs are defined twice',
  )

  // And the host's own definition is the one that survived.
  const theirs = config.collections.find((collection) => collection.slug === 'random-selections')
  assert.deepEqual(theirs?.fields.map((field) => field.name), ['seq'])
})
