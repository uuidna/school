import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PublishedSchool } from './schema.js'

import {
  article,
  breadcrumbs,
  digitalDocument,
  graph,
  idOf,
  imageObject,
  itemList,
  jsonLd,
  organisation,
  webPage,
  webSite,
} from './schema.js'

const SCHOOL: PublishedSchool = {
  address: { country: 'BG', locality: 'Банкя', region: 'София' },
  description: 'Официален сайт.',
  name: 'ПГТ „Алеко Константинов“',
  type: 'HighSchool',
  url: 'https://example.bg',
}

// THE FAILURE MODE OF STRUCTURED DATA IS NOT AN EMPTY FIELD — it is a
// confident wrong one, republished by every aggregator that read it. A school
// whose street nobody recorded must say nothing about its street.

test('states only what it was given', () => {
  const node = organisation(SCHOOL)
  assert.equal(node.name, 'ПГТ „Алеко Константинов“')
  assert.ok(!('telephone' in node), 'invented a telephone')
  assert.ok(!('email' in node), 'invented an email')
  const address = node.address as Record<string, unknown>
  assert.ok(!('streetAddress' in address), 'invented a street')
  assert.equal(address.addressLocality, 'Банкя')
})

test('an empty list is not a list', () => {
  assert.ok(!('sameAs' in organisation({ ...SCHOOL, sameAs: [] })))
})

// A MUTATION SURVIVED HERE. Every absence test passed `undefined`, and
// `SCHOOL_TELEPHONE=` in a .env file gives you '' — so a variable that exists
// and says nothing would have published an empty telephone, and deleting the
// empty-string check broke no test.
test('a field set to nothing is not a field', () => {
  const node = organisation({ ...SCHOOL, email: '', telephone: '' })
  assert.ok(!('telephone' in node), 'published an empty telephone')
  assert.ok(!('email' in node), 'published an empty email')
  const address = organisation({
    ...SCHOOL,
    address: { country: 'BG', locality: 'Банкя', postalCode: '', street: '' },
  }).address as Record<string, unknown>
  assert.ok(!('streetAddress' in address), 'published an empty street')
  assert.ok(!('postalCode' in address), 'published an empty postal code')
})

test('says which kind of school, because School and HighSchool are different searches', () => {
  assert.equal(organisation(SCHOOL)['@type'], 'HighSchool')
  assert.equal(organisation({ name: 'x', url: 'https://x.bg' })['@type'], 'School')
})

test('a trailing slash does not make a second identity', () => {
  assert.equal(
    organisation({ ...SCHOOL, url: 'https://example.bg/' })['@id'],
    organisation(SCHOOL)['@id'],
  )
})

test('nodes point at the organisation instead of repeating it', () => {
  const page = webPage(SCHOOL, { title: 'Прием', url: 'https://example.bg/priem' })
  assert.deepEqual(page.about, { '@id': idOf(SCHOOL.url, 'organisation') })
  assert.deepEqual(page.isPartOf, { '@id': idOf(SCHOOL.url, 'website') })
  // The reference has to resolve, or it is decoration.
  const nodes = graph([organisation(SCHOOL), webSite(SCHOOL), page])['@graph'] as Record<
    string,
    unknown
  >[]
  const ids = new Set(nodes.map((node) => node['@id']))
  assert.ok(ids.has(idOf(SCHOOL.url, 'organisation')))
  assert.ok(ids.has(idOf(SCHOOL.url, 'website')))
})

test('a search box is advertised only when there is one', () => {
  assert.ok(!('potentialAction' in webSite(SCHOOL)))
  const withSearch = webSite(SCHOOL, { searchPath: '/search?q=' })
  const action = withSearch.potentialAction as { target: { urlTemplate: string } }
  assert.equal(action.target.urlTemplate, 'https://example.bg/search?q={search_term_string}')
})

test('the last crumb does not link to the page you are on', () => {
  const trail = breadcrumbs([
    { name: 'Начало', url: 'https://example.bg' },
    { name: 'Прием', url: 'https://example.bg/priem' },
  ])
  const items = trail.itemListElement as Record<string, unknown>[]
  assert.equal(items[0]!.position, 1)
  assert.equal(items[0]!.item, 'https://example.bg')
  assert.equal(items[1]!.position, 2)
  assert.ok(!('item' in items[1]!), 'linked the current page to itself')
})

test('positions are 1-based, or the list is read as unordered', () => {
  const list = itemList(['https://example.bg/a', 'https://example.bg/b'])
  const items = list.itemListElement as Record<string, unknown>[]
  assert.deepEqual(
    items.map((item) => item.position),
    [1, 2],
  )
  assert.equal(list.numberOfItems, 2)
})

test('a school with no named author publishes as itself', () => {
  const post = article(SCHOOL, { title: 'Новина', url: 'https://example.bg/posts/n' })
  assert.deepEqual(post.author, { '@id': idOf(SCHOOL.url, 'organisation') })
  assert.equal(post['@type'], 'NewsArticle')
})

test('a modified date defaults to publication, never to now', () => {
  const post = article(SCHOOL, {
    datePublished: '2026-09-01T00:00:00.000Z',
    title: 'Новина',
    url: 'https://example.bg/posts/n',
  })
  assert.equal(post.dateModified, '2026-09-01T00:00:00.000Z')
  const undated = article(SCHOOL, { title: 'Новина', url: 'https://example.bg/posts/n' })
  assert.ok(!('dateModified' in undated), 'invented a modification date')
})

test('a mandated document carries its format, so a crawler need not guess', () => {
  const doc = digitalDocument(SCHOOL, {
    encodingFormat: 'application/pdf',
    name: 'Бюджет 2026',
    sizeBytes: 12_345,
    url: 'https://example.bg/api/media/file/budget.pdf',
  })
  assert.equal(doc['@type'], 'DigitalDocument')
  assert.equal(doc.encodingFormat, 'application/pdf')
  assert.equal(doc.contentSize, '12345', 'contentSize must be a string')
  assert.deepEqual(doc.publisher, { '@id': idOf(SCHOOL.url, 'organisation') })
})

test('a zero-byte file still says it is zero bytes', () => {
  // `stated` drops empty values; 0 is a value.
  const doc = digitalDocument(SCHOOL, { name: 'x', sizeBytes: 0, url: 'https://example.bg/x' })
  assert.equal(doc.contentSize, '0')
})

test('an image states its own url twice, because consumers read different keys', () => {
  const image = imageObject({ url: 'https://example.bg/i.jpg', width: 800 })
  assert.equal(image.contentUrl, 'https://example.bg/i.jpg')
  assert.equal(image.url, 'https://example.bg/i.jpg')
  assert.equal(image.width, 800)
})

// A TITLE IS EDITOR-SUPPLIED TEXT. Inside a script element the HTML parser is
// still hunting for `</script`, so a title containing one ends the element and
// turns the rest of the page into markup. This is script injection through the
// „Заглавие" field of a school's admin panel.

test('a title cannot close the script element it is inside', () => {
  const hostile = '</script><img src=x onerror=alert(1)>'
  const serialised = jsonLd(graph([webPage(SCHOOL, { title: hostile, url: 'https://example.bg/x' })]))
  assert.ok(!serialised.includes('</script'), 'escaped from the script element')
  assert.ok(!serialised.includes('<'), 'a raw < survived')
  assert.ok(!serialised.includes('>'), 'a raw > survived')
  // Escaped, not mangled: a consumer must read back exactly what the editor typed.
  const parsed = JSON.parse(serialised) as { '@graph': { name: string }[] }
  assert.equal(parsed['@graph'][0]!.name, hostile)
})

test('an ampersand and a line separator survive as themselves', () => {
  const text = 'Прием & план\u2028втори ред'
  const serialised = jsonLd(graph([webPage(SCHOOL, { title: text, url: 'https://example.bg/x' })]))
  assert.ok(!serialised.includes('&'), 'a raw & survived')
  assert.ok(!serialised.includes('\u2028'), 'a raw U+2028 survived')
  const parsed = JSON.parse(serialised) as { '@graph': { name: string }[] }
  assert.equal(parsed['@graph'][0]!.name, text)
})

test('the graph drops nothing it was given and nothing it was not', () => {
  const nodes = graph([organisation(SCHOOL), null, undefined, webSite(SCHOOL)])
  assert.equal((nodes['@graph'] as unknown[]).length, 2)
  assert.equal(nodes['@context'], 'https://schema.org')
})

test('a statutory document says which provision requires it', () => {
  const doc = digitalDocument(SCHOOL, {
    citesLegislation: 'ЗПУО чл. 263, ал. 2, т. 1',
    name: 'Стратегия за развитие',
    url: 'https://example.bg/s.pdf',
  })
  assert.deepEqual(doc.citation, { '@type': 'Legislation', name: 'ЗПУО чл. 263, ал. 2, т. 1' })
})

test('a document nobody cited says nothing about legislation', () => {
  const doc = digitalDocument(SCHOOL, { name: 'x', url: 'https://example.bg/x.pdf' })
  assert.ok(!('citation' in doc))
})
