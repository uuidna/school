import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_LOCALE, localeFromAcceptLanguage, localeFromRequest, schoolLocalization } from './index.js'

// A READER WHO ASKED FOR NOTHING IS NOT ASSUMED TO READ BULGARIAN. Locale
// negotiation is the one piece of this package a member of the public meets
// first, and it was the only module with no tests at all.

test('a reader who asks for nothing gets the default', () => {
  assert.equal(localeFromAcceptLanguage(null), 'en')
  assert.equal(localeFromAcceptLanguage(''), 'en')
  assert.equal(localeFromAcceptLanguage(undefined), 'en')
})

test('quality values decide between two supported languages', () => {
  assert.equal(localeFromAcceptLanguage('bg;q=0.8, en;q=0.9'), 'en')
  assert.equal(localeFromAcceptLanguage('en;q=0.5, bg;q=0.9'), 'bg')
})

test('a regional tag matches its base language', () => {
  assert.equal(localeFromAcceptLanguage('bg-BG'), 'bg')
  assert.equal(localeFromAcceptLanguage('en-GB,en;q=0.9'), 'en')
})

test('a supported language is served, whichever ray it is', () => {
  // The seven rays are uuidna's DIMENSIONS, not a list chosen here.
  for (const [header, expected] of [
    ['de-DE,de;q=0.9', 'de'],
    ['ru', 'ru'],
    ['zh-CN', 'zh'],
    ['fr-CA,fr;q=0.8', 'fr'],
    ['es-419', 'es'],
  ]) {
    assert.equal(localeFromAcceptLanguage(header!), expected, `${header} was not served as ${expected}`)
  }
})

test('a language outside the rays falls back rather than guessing a neighbour', () => {
  // Not Portuguese to Spanish, not Ukrainian to Russian. A reader who asked
  // for a language this school does not have gets the default, not a guess
  // about what they might tolerate.
  assert.equal(localeFromAcceptLanguage('pt-BR,pt;q=0.9'), 'en')
  assert.equal(localeFromAcceptLanguage('uk'), 'en')
  assert.equal(localeFromAcceptLanguage('ja'), 'en')
})

test('the first supported language wins when qualities tie', () => {
  assert.equal(localeFromAcceptLanguage('bg,en'), 'bg')
})

test('a language explicitly refused is not selected', () => {
  // q=0 means "not acceptable". Serving it anyway ignores the reader.
  assert.equal(localeFromAcceptLanguage('bg;q=0, en;q=0.5'), 'en')
  assert.equal(localeFromAcceptLanguage('bg;q=0'), 'en')
})

test('a wildcard takes the fallback rather than the first listed language', () => {
  assert.equal(localeFromAcceptLanguage('*'), 'en')
})

test('a malformed quality does not select the language', () => {
  assert.equal(localeFromAcceptLanguage('bg;q=banana, en;q=0.1'), 'en')
})

test("a school may serve its own language first without becoming unreadable", () => {
  // jurisdictionFor('bg').defaultLocale is 'bg'.
  assert.equal(localeFromAcceptLanguage(null, 'bg'), 'bg')
  assert.equal(localeFromAcceptLanguage('en', 'bg'), 'en')
})

test('a request is read through its header', () => {
  const headers = new Headers({ 'accept-language': 'bg-BG,bg;q=0.9' })
  assert.equal(localeFromRequest(headers), 'bg')
  assert.equal(localeFromRequest(new Headers()), DEFAULT_LOCALE)
})

test('a half-translated site reads rather than blanks', () => {
  const config = schoolLocalization('bg')

  assert.equal(config.fallback, true)
  assert.equal(config.defaultLocale, 'bg')
  assert.deepEqual(
    config.locales.map((l) => l.code).sort(),
    ['bg', 'de', 'en', 'es', 'fr', 'ru', 'zh'],
  )
})

test('every ray is labelled in its own language', () => {
  // A language picker that lists "Bulgarian" to a Bulgarian reader is a picker
  // written for somebody else.
  for (const locale of schoolLocalization().locales) {
    assert.ok(locale.label.length > 0, `${locale.code} has no label`)
  }
  const labels = Object.fromEntries(schoolLocalization().locales.map((l) => [l.code, l.label]))
  assert.equal(labels.bg, 'Български')
  assert.equal(labels.de, 'Deutsch')
  assert.equal(labels.zh, '中文')
})
