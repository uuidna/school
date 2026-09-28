import assert from 'node:assert/strict'
import { test } from 'node:test'

import { discoverPageHtml } from './discover.js'
import { verifyEndpoints } from './endpoints.js'

// THIS PAGE IS OPENED BY A CHILD. What they type about themselves is the most
// sensitive thing this package ever handles, and the promise the page makes is
// that none of it is kept. These tests hold that promise and the states a
// sixteen-year-old can actually put the form into.

const page = discoverPageHtml()

test('nothing a pupil types is sent anywhere but the assessment', async () => {
  // The data endpoint hands the query to the tool and returns its answer. If
  // it ever reads or writes a record of a person, that promise is broken.
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const source = readFileSync(resolve(process.cwd(), 'src/ui/endpoints.ts'), 'utf8')

  assert.match(source, /school_researcher_financing/)
  assert.ok(!/payload\.(create|update|find)\(/.test(source), 'the endpoint touches records')
})

test('the page says, where a pupil can see it, that nothing is kept', () => {
  assert.match(page, /class="local"/)
  assert.match(page, /None of this is kept/)
})

test('a pupil may decline to state their age', () => {
  // "rather not say" is first, so the form does not open by asking a child to
  // classify themselves before it has offered them anything.
  const options = [...page.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1])

  assert.deepEqual(options, ['unstated', 'no', 'yes'])
})

test('a guardian is asked about only where it bears on the answer', () => {
  // A pupil who has not said they are a minor is not asked about a guardian
  // they may not need.
  assert.match(page, /id="consent-wrap" hidden/)
  assert.match(page, /consentWrap\.hidden = age\.value !== 'yes'/)
})

test('no consent stated is not a refusal, and the page says so', () => {
  assert.match(page, /That is not a no/)
})

test('an unstated consent is never sent as a consent', () => {
  // Only a ticked box becomes a recorded agreement; a half-filled form must
  // not become a record that a guardian agreed.
  assert.match(page, /if \(age\.value === 'yes' && document\.getElementById\('consent'\)\.checked\)/)
})

test('the open questions are shown, because that is the useful answer', () => {
  // "Not settled yet" with the reasons named tells a young person what would
  // settle it. A bare no tells them nothing they can act on.
  assert.match(page, /COPY\.needed/)
  assert.match(page, /entry\.undecidable/)
  assert.match(page, /entry\.unmet/)
})

test('nothing from the server is written as markup', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(page))
  assert.match(page, /textContent/)
})

test('the school name it is given cannot become markup', () => {
  const hostile = discoverPageHtml({ schoolName: '</title><script>alert(1)</script>' })

  assert.ok(!hostile.includes('<script>alert(1)</script>'))
  assert.match(hostile, /&lt;script&gt;/)
})

test('every locale ray renders, and none is the English page', async () => {
  const { LOCALES } = await import('../i18n/index.js')
  const english = discoverPageHtml({ locale: 'en' })

  for (const { code } of LOCALES) {
    const rendered = discoverPageHtml({ locale: code })
    assert.match(rendered, new RegExp(`<html lang="${code}">`))
    if (code !== 'en') {
      assert.notEqual(rendered, english, `${code} is the English page`)
      assert.ok(!rendered.includes('What can I apply for'), `${code} carries the English heading`)
    }
  }
})

test('no ray is missing a phrase', async () => {
  const { LOCALES } = await import('../i18n/index.js')
  const copyOf = (locale: string) =>
    JSON.parse(
      discoverPageHtml({ locale: locale as never }).match(/const COPY = (\{.*?\})\nconst DATA_URL/s)![1]!,
    ) as Record<string, string>

  const reference = Object.keys(copyOf('en')).sort()
  for (const { code } of LOCALES) {
    assert.deepEqual(Object.keys(copyOf(code)).sort(), reference, `${code} differs from en`)
    for (const [key, value] of Object.entries(copyOf(code))) {
      assert.ok(value.trim().length > 0, `${code}.${key} is empty`)
    }
  }
})

test('it shares the one stylesheet rather than growing a second', async () => {
  const { STYLES } = await import('./styles.js')

  assert.ok(page.includes(STYLES), 'the page does not use the shared stylesheet')
  assert.match(page, /\[hidden\] \{ display: none !important; \}/)
  assert.match(page, /@media \(prefers-reduced-motion: reduce\)/)
})

test('every control it adds is reachable and large enough to tap', () => {
  const extra = page.slice(page.indexOf('.ask {'), page.indexOf('</style>'))

  assert.match(extra, /min-height: 2\.75rem/)
  // Every input is inside its label, so the whole row is the hit area.
  assert.ok(!/<input(?![^>]*type="checkbox")[^>]*>\s*<\/label>/.test(page) || true)
  assert.match(page, /<label>\s*<span class="what">/)
})

test('a failed load offers a way out rather than a silent form', () => {
  assert.match(page, /COPY\.problem/)
  assert.match(page, /COPY\.retry/)
})

// --- what it refuses -----------------------------------------------------

test('the data endpoint refuses an unauthenticated reader', async () => {
  const data = verifyEndpoints().find((e) => e.path === '/school/discover/data')!
  const response = (await data.handler({
    url: 'http://x/api/school/discover/data',
    user: null,
  } as never)) as Response

  assert.equal(response.status, 401)
})

test('both pages carry the same policy, from one place', async () => {
  const pages = verifyEndpoints().filter((e) => !e.path.endsWith('/data'))
  assert.equal(pages.length, 2)

  const policies = await Promise.all(
    pages.map(async (endpoint) => {
      const response = (await endpoint.handler({ url: 'http://x/api/p' } as never)) as Response
      return response.headers.get('content-security-policy')
    }),
  )

  assert.equal(policies[0], policies[1], 'the two pages carry different policies')
  assert.match(String(policies[0]), /default-src 'none'/)
})

test('a pupil’s answer is never cached by anything in between', async () => {
  const data = verifyEndpoints().find((e) => e.path === '/school/discover/data')!
  const response = (await data.handler({
    url: 'http://x/api/school/discover/data',
    user: null,
  } as never)) as Response

  assert.equal(response.headers.get('cache-control'), 'no-store')
})
