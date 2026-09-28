import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Payload } from 'payload'

import { assertSchema, verifySchema } from './schema.js'

// THE ANSWER IS NOT IN THIS PACKAGE. @uuidna/school defines none of these
// collections; the host does. So the guard must read the host's config and
// decide from it, and these tests feed it configs it has never seen — one that
// meets the requirements and one that does not. A guard that passes both is
// furniture.

const host = (collections: Record<string, unknown>, editor?: Record<string, unknown>): Payload =>
  ({ collections, config: { editor } } as unknown as Payload)

const field = (name: string, unique = false) => ({ name, unique })

const wellFormed = () =>
  host({
    documents: { config: { flattenedFields: [field('title'), field('tenant')] } },
    'random-selections': {
      config: {
        flattenedFields: [field('seq'), field('tenant'), field('chainHash', true)],
        sanitizedIndexes: [{ fields: [{ path: 'tenant' }, { path: 'seq' }], unique: true }],
      },
    },
    users: { config: { flattenedFields: [field('email'), field('tenants')], versions: { maxPerDoc: 0 } } },
  })

test('a host that meets every requirement passes', () => {
  const unmet = verifySchema(wellFormed()).filter((f) => !f.satisfied)
  assert.deepEqual(unmet, [], JSON.stringify(unmet, null, 2))
  assert.doesNotThrow(() => assertSchema(wellFormed()))
})

test('the guard actually decides something — it reports the checks it ran', () => {
  const findings = verifySchema(wellFormed())
  assert.ok(findings.length >= 3, `expected real checks, got ${findings.length}`)
})

test('a tenant field named differently is caught, not silently filtered on', () => {
  // The crack this closes: TENANT_PATH says 'tenant', the host calls it
  // 'school'. Reads would filter on a field that is not there.
  const findings = verifySchema(
    host({ documents: { config: { flattenedFields: [field('title'), field('school')] } } }),
  )

  const documents = findings.find((f) => f.collection === 'documents')
  assert.equal(documents?.satisfied, false)
  assert.match(String(documents?.reason), /no field "tenant"/)
})

test('a missing unique index on (tenant, seq) is caught', () => {
  // Without it two racing draws read the same head and both insert, forking
  // the chain — and every verification afterwards passes on the fork.
  const findings = verifySchema(
    host({
      'random-selections': {
        config: {
          flattenedFields: [field('seq'), field('tenant'), field('chainHash', true)],
          sanitizedIndexes: [],
        },
      },
    }),
  )

  const seq = findings.find((f) => f.requirement.includes('tenant, seq'))
  assert.equal(seq?.satisfied, false)
  assert.match(String(seq?.reason), /fork/)
})

test('a stricter unique index satisfies the requirement', () => {
  // unique(seq) forbids everything unique(tenant, seq) forbids and more: two
  // rows cannot share a seq at all, so they certainly cannot share both. A
  // single-school instance declares exactly this, and reporting it unmet would
  // invite a migration that loosened the constraint to match the message.
  const findings = verifySchema(
    host({
      'random-selections': {
        config: {
          flattenedFields: [field('seq', true), field('tenant'), field('chainHash', true)],
          sanitizedIndexes: [],
        },
      },
    }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('tenant, seq'))?.satisfied, true)
})

test('a weaker unique index does not', () => {
  // unique(tenant, seq, drawnAt) permits two rows with the same tenant and seq
  // so long as the timestamps differ — which is the fork this guard exists to
  // prevent. Adding a column to a unique index only ever permits more rows.
  const findings = verifySchema(
    host({
      'random-selections': {
        config: {
          flattenedFields: [field('seq'), field('tenant'), field('chainHash', true)],
          sanitizedIndexes: [
            {
              fields: [{ path: 'tenant' }, { path: 'seq' }, { path: 'drawnAt' }],
              unique: true,
            },
          ],
        },
      },
    }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('tenant, seq'))?.satisfied, false)
})

test('an index on something else entirely does not satisfy it', () => {
  const findings = verifySchema(
    host({
      'random-selections': {
        config: {
          flattenedFields: [field('seq'), field('tenant'), field('chainHash', true)],
          sanitizedIndexes: [{ fields: [{ path: 'drawnAt' }], unique: true }],
        },
      },
    }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('tenant, seq'))?.satisfied, false)
})

test('a non-unique compound index does not satisfy the requirement', () => {
  const findings = verifySchema(
    host({
      'random-selections': {
        config: {
          flattenedFields: [field('seq'), field('tenant'), field('chainHash', true)],
          sanitizedIndexes: [{ fields: [{ path: 'tenant' }, { path: 'seq' }], unique: false }],
        },
      },
    }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('tenant, seq'))?.satisfied, false)
})

test('assertSchema refuses to boot and names every gap at once', () => {
  const broken = host({
    documents: { config: { flattenedFields: [field('title')] } },
    'random-selections': { config: { flattenedFields: [field('seq')], sanitizedIndexes: [] } },
  })

  assert.throws(() => assertSchema(broken), (error: Error) => {
    assert.match(error.message, /does not meet/)
    // One boot names the whole gap rather than one per restart.
    assert.ok((error as { findings?: unknown[] }).findings!.length >= 3)
    return true
  })
})

test('a media library the editor cannot reference is reported', () => {
  // The failure a host actually hit: defaultLexical replaced the feature set
  // rather than extending it, UploadFeature went missing, and 419 images sat
  // in pages as literal markdown with nothing anywhere saying why.
  const findings = verifySchema(
    host({
      media: { config: { flattenedFields: [field('contentHash', true)] } },
    }, { editorConfig: { resolvedFeatureMap: new Map([['bold', {}], ['link', {}]]) } }),
  )

  const editor = findings.find((f) => f.requirement.includes('reference the media'))
  assert.equal(editor?.satisfied, false)
  assert.match(String(editor?.reason), /replaced the defaults/)
})

test('an editor that can place an upload satisfies it', () => {
  const findings = verifySchema(
    host({
      media: { config: { flattenedFields: [field('contentHash', true)] } },
    }, { editorConfig: { resolvedFeatureMap: new Map([['upload', {}], ['bold', {}]]) } }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('reference the media'))?.satisfied, true)
})

test('an editor this cannot read is not reported as broken', () => {
  // A host whose editor is shaped differently must not fail on a structure
  // this check cannot see.
  const findings = verifySchema(
    host({ media: { config: { flattenedFields: [field('contentHash', true)] } } }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('reference the media')), undefined)
})

test('a host with no media library is not asked about an editor', () => {
  const findings = verifySchema(
    host({ documents: { config: { flattenedFields: [field('title'), field('tenant')] } } }),
  )

  assert.equal(findings.find((f) => f.requirement.includes('reference the media')), undefined)
})

test('a collection this host does not serve is not a misconfiguration', () => {
  assert.doesNotThrow(() => assertSchema(host({})))
})

// D1 BINDS EVERY COLUMN TWICE, so a collection's usable width there is half
// what its column limit suggests. The failure arrives only on a write — the
// migration generates the columns happily — so a Worker that cannot process
// images can carry an impossible schema indefinitely and look healthy. These
// fixtures use the real arithmetic: seventeen base columns and six per size.

const d1Host = (sizes: number, extra = 0) => {
  const columns: Record<string, object> = {}
  for (let i = 0; i < 17 + extra; i++) columns[`base${i}`] = {}
  for (let s = 0; s < sizes; s++) {
    for (const f of ['url', 'width', 'height', 'mimeType', 'filesize', 'filename']) {
      columns[`size${s}_${f}`] = {}
    }
  }

  return {
    collections: { media: { config: { fields: [], flattenedFields: [] } } },
    db: { name: 'd1-sqlite', tables: { media: columns } },
  } as unknown as Parameters<typeof verifySchema>[0]
}

const mediaFinding = (payload: Parameters<typeof verifySchema>[0]) =>
  verifySchema(payload).find((finding) => finding.requirement.includes('columns on D1'))!

test('seven image sizes cannot be written on D1, and the finding says why', () => {
  // 17 + 42 = 59 columns, 118 parameters against a ceiling of 100.
  const finding = mediaFinding(d1Host(7))

  assert.equal(finding.satisfied, false)
  assert.match(finding.reason, /59 columns bind 118 parameters on an update/)
  // The half that was wrong the first time this was written: a create still fits.
  assert.match(finding.reason, /Creates still bind 59 and succeed/)
  assert.match(finding.reason, /binds every column twice/)
  // And it names the remedy in the unit the schema is written in.
  assert.match(finding.reason, /removing 2 of them clears it/)
})

test('five sizes fit, and the host is told how little room is left', () => {
  // 47 columns, 94 parameters. Three columns of headroom — which one plugin
  // and one field of the school's own would spend.
  const finding = mediaFinding(d1Host(5))

  assert.equal(finding.satisfied, true)
  assert.match(finding.reason, /3 column\(s\) of headroom/)
})

test('the column this package adds is the one that can cross the line', () => {
  // The reason it is worth saying at boot rather than in a docstring: at five
  // sizes a host has three columns of room, and contentHash spends one.
  const before = mediaFinding(d1Host(5))
  const after = mediaFinding(d1Host(5, 1))

  assert.equal(before.satisfied, true)
  assert.equal(after.satisfied, true)
  assert.match(after.reason, /2 column\(s\) of headroom/)

  // Three of the host's own fields, and it is over.
  assert.equal(mediaFinding(d1Host(5, 4)).satisfied, false)
})

test('the ceiling is D1’s, and is not applied to other adapters', () => {
  // Plain SQLite allows 32,766 bound parameters; postgres 65,535. Reporting
  // this against them would be a finding nobody can act on and nobody should.
  const sqlite = d1Host(7)
  ;(sqlite as unknown as { db: { name: string } }).db.name = 'sqlite'

  assert.equal(
    verifySchema(sqlite).some((finding) => finding.requirement.includes('columns on D1')),
    false,
  )
})

test('a host whose adapter exposes no tables is not reported as broken', () => {
  // Absent is not misconfigured — the same rule every other check here follows.
  const opaque = {
    collections: { media: { config: { fields: [], flattenedFields: [] } } },
    db: { name: 'd1-sqlite' },
  } as unknown as Parameters<typeof verifySchema>[0]

  assert.equal(
    verifySchema(opaque).some((finding) => finding.requirement.includes('columns on D1')),
    false,
  )
})

// THE ACCESS TRAIL IS DERIVED FROM VERSIONS, so version retention became a
// schema requirement. A truncating audit trail is worse than an absent one: it
// answers an inspection with a confident, incomplete account.
const withUsers = (versions: unknown) =>
  host({ users: { config: { flattenedFields: [field('email')], versions } } })

const retention = (payload: Payload) =>
  verifySchema(payload).find((f) => f.requirement.includes('unlimited versions'))!

test('users keeping a bounded number of versions is refused, and says what to set', () => {
  const finding = retention(withUsers({ maxPerDoc: 100 }))
  assert.equal(finding.satisfied, false)
  assert.match(finding.reason, /oldest changes are dropped/)
  assert.match(finding.reason, /Article 30/)
  assert.match(finding.reason, /maxPerDoc to 0/)
})

test('versions switched off entirely is refused, and says why it matters', () => {
  const finding = retention(withUsers(false))
  assert.equal(finding.satisfied, false)
  assert.match(finding.reason, /nothing to derive from/)
})

test('unlimited retention satisfies it', () => {
  const finding = retention(withUsers({ maxPerDoc: 0 }))
  assert.equal(finding.satisfied, true)
  assert.match(finding.reason, /kept without limit/)
})
