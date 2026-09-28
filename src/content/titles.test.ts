import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LOCALES } from '../i18n/index.js'
import { chooseTitle, genericLabel, isAddress, isGenericLabel, names } from './titles.js'

// THE FAULT THIS RULE EXISTS FOR. `\b` is ASCII — `\w` is [A-Za-z0-9_] — so
// after „изтегли", Cyrillic on the left and a space on the right, JavaScript
// sees no word boundary and `/^изтегли\b/` never matches. Twenty documents
// were about to be registered under the words on the button.
test('a Cyrillic label is recognised, which \\b would not have done', () => {
  assert.equal(isGenericLabel('Изтегли PDF'), true)
  assert.equal(/^изтегли\b/i.test('Изтегли PDF'), false, 'the ASCII version still fails, as it did')
})

test('every ray recognises its own words', () => {
  const samples: Record<string, string> = {
    bg: 'Изтегли документа',
    de: 'Hier klicken',
    en: 'Download the file',
    es: 'Descargar el documento',
    fr: 'Télécharger le document',
    ru: 'Скачать документ',
    zh: '下载文件',
  }
  for (const { code } of LOCALES) {
    assert.equal(isGenericLabel(samples[code]!, code), true, `${code} does not recognise its own`)
    // And the union recognises all of them, because a page in one language
    // routinely carries a button left in another.
    assert.equal(isGenericLabel(samples[code]!), true, `the union misses ${code}`)
  }
})

test('a real name is not mistaken for a label', () => {
  for (const title of ['Бюджет 2026', 'Стратегия за развитие', 'Haushaltsplan 2026', '2026 年度预算']) {
    assert.equal(isGenericLabel(title), false, `${title} was read as generic`)
  }
})

// „документ" is generic; „Документ към бюджет 2019" is a perfectly good name,
// and the boundary is what tells them apart.
test('a generic word inside a longer name does not condemn it', () => {
  assert.equal(isGenericLabel('Документ към бюджет 2019'), true, 'it does lead with the word')
  assert.equal(isGenericLabel('Отчет към документ 2019'), false)
})

test('an address is not a name, however long', () => {
  assert.equal(isAddress('/files/daa064_fa36.pdf'), true)
  assert.equal(isAddress('https://example.bg/a'), true)
  assert.equal(isAddress('Бюджет 2026'), false)
  assert.equal(names('/files/daa064_fa36.pdf'), false, 'an address walked through as a name')
})

test('the heading above is used when the link names nothing', () => {
  assert.equal(chooseTitle({ above: 'Бюджет 2025', own: 'Отчет I тримесечие' }), 'Отчет I тримесечие')
  assert.equal(chooseTitle({ above: 'Издаване на диплома', own: 'Изтегли PDF' }), 'Издаване на диплома')
  assert.equal(chooseTitle({ above: '', own: 'Изтегли PDF', page: 'Училищен вестник' }), 'Училищен вестник')
})

test('the pattern is built from the table, not written beside it', () => {
  // A list and a regex that must agree are two things to keep in step. Adding
  // a word to one ray must change what that ray recognises, with no second
  // edit — so this asserts the derivation rather than a fixed string.
  const bg = genericLabel('bg')
  const en = genericLabel('en')
  assert.equal(bg.test('кликнете тук'), true)
  assert.equal(en.test('кликнете тук'), false, 'English should not know Bulgarian words')
  assert.equal(genericLabel().test('кликнете тук'), true, 'the union should')
})

test('a format name is nobody’s language and names no document either', () => {
  for (const ray of LOCALES) assert.equal(isGenericLabel('PDF', ray.code), true, `${ray.code} allowed a bare PDF`)
})
