import assert from 'node:assert/strict'
import { test } from 'node:test'

import { batchOutcome, ideaBlock, ideaField } from './host.js'

const SITE_READING = {
  fields: [
    { kind: 'text' as const, name: 'plot', required: true },
    { kind: 'number' as const, name: 'soilTemperature' },
    { kind: 'checkbox' as const, name: 'irrigated' },
    { kind: 'date' as const, name: 'observedAt' },
  ],
  label: 'Site reading',
  slug: 'site-reading',
}

// A BLOCK IS A FIELD SCHEMA, and Payload's field types carry the typing
// natively. The first version of this file tagged values as `n:3` and parsed
// them back, because form-submissions stores strings — custom logic standing in
// for a config that already existed.
test('an idea becomes a Payload block whose fields are Payload field types', () => {
  const block = ideaBlock(SITE_READING)

  assert.equal(block.slug, 'site-reading')
  assert.deepEqual(
    block.fields.map((f) => [(f as { name?: string }).name, f.type]),
    [['plot', 'text'], ['soilTemperature', 'number'], ['irrigated', 'checkbox'], ['observedAt', 'date']],
  )
})

test('a number is a number field — there is nothing to encode or parse', () => {
  const block = ideaBlock(SITE_READING)
  const temperature = block.fields.find((f) => (f as { name?: string }).name === 'soilTemperature')!
  assert.equal(temperature.type, 'number', 'Payload stores and returns a number; no tag survives a round trip because none is needed')
})

test('required and label travel into the config, not into a second description of it', () => {
  const block = ideaBlock(SITE_READING)
  const plot = block.fields.find((f) => (f as { name?: string }).name === 'plot')! as { required?: boolean }
  assert.equal(plot.required, true)
  assert.deepEqual((block as { labels?: unknown }).labels, { plural: 'Site reading', singular: 'Site reading' })
})

// ONE SHAPE, TWO PLACEMENTS. The same declaration hosts the idea inside rich
// text via BlocksFeature and on a document via a blocks field. Neither restates
// the other, which is what made the first version wrong.
test('the same shape hosts on a document without being declared twice', () => {
  const field = ideaField('readings', [SITE_READING]) as { blocks: { slug: string }[]; type: string }

  assert.equal(field.type, 'blocks')
  assert.deepEqual(field.blocks.map((b) => b.slug), ['site-reading'])
  assert.deepEqual(field.blocks[0], ideaBlock(SITE_READING), 'the same block, not a copy of its description')
})

test('a shape with no fields is refused — a block with no fields hosts nothing', () => {
  assert.throws(() => ideaBlock({ fields: [], slug: 'empty' }), /declares no fields/)
})

// ONE FIELD, ONE NAME. Payload takes the later of two same-named fields, so a
// duplicate silently drops the earlier one and the idea loses a value nobody
// notices missing.
test('a duplicated field name is refused rather than silently resolved', () => {
  assert.throws(
    () => ideaBlock({ fields: [{ kind: 'text', name: 'plot' }, { kind: 'number', name: 'plot' }], slug: 'x' }),
    /declares "plot" twice/,
  )
})

// ── references, scopes, hooks: the capabilities Payload already has ─────────

test('a reference is a relationship field, not a copy of the text', () => {
  // A copied title goes stale the moment the original is renamed, and nothing
  // in the copy says which of the two is current.
  const block = ideaBlock({
    fields: [{ kind: 'relationship', name: 'observedBy', to: 'users' }],
    slug: 'observation',
  })
  const field = block.fields[0] as { relationTo?: string; type: string }
  assert.equal(field.type, 'relationship')
  assert.equal(field.relationTo, 'users')
})

test('a reference naming no target is refused', () => {
  assert.throws(
    () => ideaBlock({ fields: [{ kind: 'relationship', name: 'x' }], slug: 'y' }),
    /reference to nothing is a text field with extra steps/,
  )
})

test('a scope travels into the field, where Payload runs it on every door', () => {
  const onlyStaff = () => true
  const block = ideaBlock({
    fields: [{ kind: 'text', name: 'note', scope: { read: onlyStaff, update: onlyStaff } }],
    slug: 'private-note',
  })
  const field = block.fields[0] as { access?: { read?: unknown; update?: unknown } }
  assert.equal(field.access?.read, onlyStaff, 'a check at a call site guards that call site; this guards the field')
  assert.equal(field.access?.update, onlyStaff)
})

test('hooks travel into the field, so the work happens on every path in', () => {
  const stamp = () => 'stamped'
  const block = ideaBlock({
    fields: [{ hooks: { beforeChange: [stamp] }, kind: 'text', name: 'slug' }],
    slug: 'stamped-thing',
  })
  const field = block.fields[0] as { hooks?: { beforeChange?: unknown[] } }
  assert.deepEqual(field.hooks?.beforeChange, [stamp])
})

test('index and unique are the store\'s promises, and are passed as such', () => {
  const block = ideaBlock({
    fields: [{ index: true, kind: 'text', name: 'plot', unique: true }],
    slug: 'plot',
  })
  const field = block.fields[0] as { index?: boolean; unique?: boolean }
  assert.equal(field.index, true)
  assert.equal(field.unique, true, 'the one promise a field cannot make in code')
})

// ── a batch that cannot hide a partial failure ──────────────────────────────

test('a batch with refusals is not complete, and names each one', () => {
  const out = batchOutcome({
    docs: [{ id: 1 }, { id: 2 }],
    errors: [{ id: 3, message: 'field access refused the update' }],
  })

  assert.equal(out.changed, 2)
  assert.equal(out.attempted, 3)
  assert.equal(out.complete, false, 'two of three is not "it worked"')
  assert.deepEqual(out.refused, [{ id: 3, reason: 'field access refused the update' }])
})

// AN EMPTY BATCH IS NOT A COMPLETE ONE, and it is the likeliest outcome of a
// typo in the filter: no docs, no errors, which reads as success everywhere.
test('a batch that matched nothing is not reported as complete', () => {
  const out = batchOutcome({ docs: [], errors: [] })
  assert.equal(out.attempted, 0)
  assert.equal(out.changed, 0)
  assert.equal(out.complete, false, 'nothing was tried, so nothing succeeded')
})

test('a batch where everything landed is complete', () => {
  const out = batchOutcome({ docs: [{ id: 1 }, { id: 2 }] })
  assert.equal(out.complete, true)
  assert.equal(out.attempted, 2)
  assert.deepEqual(out.refused, [])
})

test('a refusal with no message still carries a reason', () => {
  const out = batchOutcome({ docs: [], errors: [{ id: 9 }] })
  assert.match(out.refused[0]!.reason, /gave no reason/, 'silence is reported, not dropped')
})
