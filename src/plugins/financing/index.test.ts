import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Config } from 'payload'

import { TENANT_PATH } from '../../payload/scope.js'
import { financingPlugin, financingProgrammes } from './index.js'

// A ROW THAT REACHES THE DATABASE WITHOUT PROVENANCE IS A ROW SOMEBODY LATER
// READS OUT OF IT AND TRUSTS. The engine refuses one; the schema has to refuse
// it too, or the engine is the only thing standing between an invented funding
// condition and a school acting on it.

const collection = () => financingProgrammes()

const field = (name: string) =>
  collection().fields.find((f) => 'name' in f && f.name === name) as
    | undefined
    | { fields?: { name?: string; required?: boolean }[]; required?: boolean }

test('provenance is required by the schema, not only by the engine', () => {
  const provenance = field('provenance')!
  const api = provenance.fields!.find((f) => f.name === 'api')!
  const fetchedAt = provenance.fields!.find((f) => f.name === 'fetchedAt')!

  assert.equal(api.required, true)
  assert.equal(fetchedAt.required, true)
})

test('a deployment may constrain which sources a programme can claim', () => {
  const constrained = financingProgrammes({ allowedApis: ['eu:funding-tenders'] })
  const provenance = constrained.fields.find(
    (f) => 'name' in f && f.name === 'provenance',
  ) as { fields: { name?: string; options?: unknown; type?: string }[] }

  const api = provenance.fields.find((f) => f.name === 'api')!
  assert.equal(api.type, 'select')
  assert.deepEqual(api.options, ['eu:funding-tenders'])
})

test('without a stated list the source is free text, not absent', () => {
  const provenance = field('provenance')!
  assert.equal(provenance.fields!.find((f) => f.name === 'api')!.required, true)
})

test('the catalogue is global, and TENANT_PATH says so in one place', () => {
  // A programme published by the Commission is the same programme for every
  // school here; per-school copies of a public catalogue drift.
  assert.equal(TENANT_PATH['financing-programmes'], null)
  assert.ok(
    !collection().fields.some((f) => 'name' in f && f.name === 'tenant'),
    'the catalogue was scoped to a school',
  )
})

test('a programme is identified once, and cannot be recorded twice', () => {
  const id = collection().fields.find((f) => 'name' in f && f.name === 'programmeId') as {
    required?: boolean
    unique?: boolean
  }

  assert.equal(id.unique, true)
  assert.equal(id.required, true)
})

test('criteria carry the authority’s own wording, so a refusal can quote it', () => {
  const criteria = collection().fields.find((f) => 'name' in f && f.name === 'criteria') as {
    fields: { name?: string; options?: string[]; required?: boolean }[]
  }

  assert.equal(criteria.fields.find((f) => f.name === 'describe')!.required, true)

  // The operators the engine implements, and no others — an op the engine
  // cannot compare is undecidable, so offering one here would manufacture
  // undecidable programmes.
  const op = criteria.fields.find((f) => f.name === 'op')!
  assert.deepEqual(op.options!.sort(), ['eq', 'gte', 'has', 'in', 'lte', 'neq'])
})

test('the plugin adds the catalogue and disturbs nothing else', () => {
  const base = { collections: [{ fields: [], slug: 'tenants' }] } as unknown as Config
  const out = financingPlugin()(base) as Config

  const slugs = out.collections!.map((c) => c.slug)
  assert.deepEqual(slugs.sort(), ['financing-programmes', 'national-catalogues', 'tenants'])
})

test('a window left empty is empty, never defaulted to open', () => {
  const opens = collection().fields.find((f) => 'name' in f && f.name === 'opens') as {
    defaultValue?: unknown
    required?: boolean
  }

  assert.equal(opens.required, undefined)
  assert.equal(opens.defaultValue, undefined)
})
