import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SlugStyle } from './slug.js'

import { slugField, slugify, transliterate } from './slug.js'

/** The beforeValidate hook, narrowed out of the Field union. */
const derive = (style?: SlugStyle) => {
  const field = slugField(style ? { style } : {}) as unknown as {
    hooks: { beforeValidate: ((args: unknown) => unknown)[] }
  }
  return field.hooks.beforeValidate[0]!
}

// THE BUG THIS MODULE EXISTS FOR WAS NEVER TESTED. Payload's own slugField
// strips with /[^\w-]+/, and \w is ASCII — so „Учебни планове" became
// "--------" and every Bulgarian page collided on the unique index.

test('a new path is international, not the title’s own script', () => {
  // A URL is an address. One that only a reader of one script can type, quote
  // in an order, or paste into a form is narrower than it looks.
  assert.equal(slugify('Учебни планове'), 'uchebni-planove')
  assert.match(slugify('Учебни планове'), /^[a-z0-9-]+$/)
})

test('Cyrillic survives where a school asks for it', () => {
  // The dedicated localised case: pages whose URLs have existed for years.
  assert.equal(slugify('Учебни планове', 'keep'), 'учебни-планове')
  assert.notEqual(slugify('Учебни планове', 'keep'), '--------')
})

test('two different Bulgarian titles do not collide', () => {
  // The actual failure: every one of them became the same string.
  const a = slugify('Учебни планове')
  const b = slugify('Правилник за дейността')

  assert.notEqual(a, b)
  assert.ok(a.length > 1 && b.length > 1)
})

test('romanise follows the official transliteration', () => {
  assert.equal(transliterate('щ'), 'sht')
  assert.equal(transliterate('ю'), 'yu')
  assert.equal(transliterate('я'), 'ya')
  assert.equal(slugify('Стратегия за развитие', 'romanise'), 'strategiya-za-razvitie')
})

test('romanise leaves nothing non-ascii behind', () => {
  assert.match(slugify('Правилник за дейността', 'romanise'), /^[a-z0-9-]+$/)
})

test('separators collapse and do not dangle', () => {
  assert.equal(slugify('  Учебни   планове  ', 'keep'), 'учебни-планове')
  assert.equal(slugify('!!! Бюджет ???', 'keep'), 'бюджет')
  assert.equal(slugify('--a--b--'), 'a-b')
})

test('a title of only punctuation yields an empty slug, not a dash', () => {
  // An empty slug is a visible failure; '-' is a silent collision.
  assert.equal(slugify('!!!'), '')
  assert.equal(slugify('   '), '')
  assert.equal(slugify('!!!', 'keep'), '')
})

test('truncation never leaves a trailing separator', () => {
  const long = slugify('а '.repeat(300), 'keep')
  assert.ok(long.length <= 200)
  assert.ok(!long.endsWith('-'), 'a truncated slug ended on a separator')
})

test('the field derives an international slug by default', () => {
  assert.equal(derive()({ data: { title: 'Учебни планове' }, value: undefined }), 'uchebni-planove')
})

test('a collection may ask to keep its own script', () => {
  assert.equal(derive('keep')({ data: { title: 'Учебни планове' }, value: undefined }), 'учебни-планове')
})

test('a slug the editor typed is normalised, not discarded', () => {
  assert.equal(derive()({ data: { title: 'X' }, value: '  Moyat Adres  ' }), 'moyat-adres')
  assert.equal(derive('keep')({ data: { title: 'X' }, value: '  Моят Адрес  ' }), 'моят-адрес')
})

test('the field can romanise where the URL is new', () => {
  assert.equal(
    derive('romanise')({ data: { title: 'Стратегия за развитие' }, value: undefined }),
    'strategiya-za-razvitie',
  )
})

test('an existing slug survives a save that did not touch it', () => {
  // Re-saving 74 pages to fix their headings rewrote six Cyrillic slugs to the
  // romanised default and 404'd six live, indexed URLs. An address that
  // predates a policy is still an address.
  const kept = derive()({
    data: { title: 'Учебни планове' },
    operation: 'update',
    originalDoc: { slug: 'учебни-планове' },
    value: 'учебни-планове',
  })

  assert.equal(kept, 'учебни-планове')
})

test('a slug the editor actually changed is normalised', () => {
  const edited = derive()({
    data: { title: 'X' },
    operation: 'update',
    originalDoc: { slug: 'old-address' },
    value: '  My New Address  ',
  })

  assert.equal(edited, 'my-new-address')
})

test('a new document still derives one', () => {
  const created = derive()({
    data: { title: 'Учебни планове' },
    operation: 'create',
    value: undefined,
  })

  assert.equal(created, 'uchebni-planove')
})

test('a slug typed on create is normalised, not preserved verbatim', () => {
  const typed = derive()({ data: { title: 'X' }, operation: 'create', value: '  Some Thing  ' })

  assert.equal(typed, 'some-thing')
})

test('the slug is unique and indexed, which is what made the collision fatal', () => {
  const field = slugField() as { index?: boolean; unique?: boolean }
  assert.equal(field.unique, true)
  assert.equal(field.index, true)
})
