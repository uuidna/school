import assert from 'node:assert/strict'
import { test } from 'node:test'

import { verifyEndpoints } from './endpoints.js'
import { verifyPageHtml } from './page.js'

// A GAP IN ANY STATE A READER CAN PUT THIS IN IS A PARENT WHO CANNOT READ THE
// ANSWER. Dark, light, narrow, keyboard-only, reduced motion, high contrast,
// printed. The page is also the only surface here a stranger might reach, so
// what it does not do matters as much as what it shows.

const page = verifyPageHtml()

test('it is one document that needs nothing from the network', () => {
  // A verification page that cannot load without a CDN stops working on the
  // day it matters.
  assert.ok(!/<script[^>]+src=/i.test(page), 'the page loads an external script')
  assert.ok(!/<link[^>]+stylesheet/i.test(page), 'the page loads an external stylesheet')
  assert.ok(!/https?:\/\/(?!localhost)/.test(page.replace(/<!--[\s\S]*?-->/g, '')), 'the page reaches offsite')
})

test('it declares its language, encoding and viewport', () => {
  assert.match(page, /<html lang="en">/)
  assert.match(page, /<meta charset="utf-8">/)
  assert.match(page, /name="viewport" content="width=device-width, initial-scale=1"/)
})

test('it is readable in both colour schemes', () => {
  // Not one palette with the other bolted on: both are stated.
  assert.match(page, /color-scheme: light dark/)
  assert.match(page, /@media \(prefers-color-scheme: dark\)/)

  const dark = page.slice(page.indexOf('prefers-color-scheme: dark'))
  for (const token of ['--bg', '--surface', '--ink', '--muted', '--line', '--pass', '--fail', '--open', '--focus']) {
    assert.ok(dark.includes(token), `${token} has no dark value`)
  }
})

test('every colour it paints on screen comes from a declared token', () => {
  // A literal colour is the one that gets forgotten in the other scheme.
  //
  // Print is the deliberate exception and the only one: paper wants absolute
  // black on white whatever the reader's theme is, and a token there would
  // print a dark page. The exemption is the print block alone, and the next
  // test checks that block is actually where those literals live.
  const styles = page.slice(page.indexOf('<style>'), page.indexOf('</style>'))
  const printAt = styles.indexOf('@media print')
  const onScreen = printAt === -1 ? styles : styles.slice(0, printAt)

  const literals = onScreen
    .split('\n')
    .filter((line) => /(^|[^-\w])(#[0-9a-f]{3,8}\b|rgba?\()/i.test(line))
    .filter((line) => !line.includes('--') && !line.includes('@media'))

  assert.deepEqual(literals, [], 'these paint a literal colour instead of a token')
})

test('the print block is where those literals are, and it is small', () => {
  // So the exemption cannot quietly grow into a second stylesheet.
  const styles = page.slice(page.indexOf('<style>'), page.indexOf('</style>'))
  const lines = styles.split('\n')
  const start = lines.findIndex((line) => line.startsWith('@media print'))
  assert.ok(start >= 0, 'there is no print block')

  // To the closing brace of the block, not to the end of the stylesheet.
  const end = lines.findIndex((line, i) => i > start && line === '}')
  const print = lines.slice(start, end + 1)

  assert.ok(print.join('\n').includes('background: #fff'))
  assert.ok(print.join('\n').includes('color: #000'))
  assert.ok(print.length < 10, `the print exemption has grown to ${print.length} lines`)
})

test('an element marked hidden is actually hidden', () => {
  // The browser's own [hidden] rule is out-specified by any display rule, so
  // .scope { display: flex } kept showing an empty class row. Found by looking
  // at the page rather than by reading it.
  assert.match(page, /\[hidden\] \{ display: none !important; \}/)
})

test('every element the page hides has that rule covering it', () => {
  const styles = page.slice(page.indexOf('<style>'), page.indexOf('</style>'))
  const hidden = [...page.matchAll(/id="([\w-]+)"[^>]*\shidden/g)].map((m) => m[1]!)

  assert.ok(hidden.length > 0, 'nothing is hidden, so this guard is checking nothing')
  // The rule is global, so covering them all is one assertion — but the set
  // is listed so a new hidden element without a display rule is still fine.
  assert.ok(styles.includes('[hidden]'))
})

test('motion stops when the reader asks it to', () => {
  assert.match(page, /@media \(prefers-reduced-motion: reduce\)/)

  const reduced = page.slice(page.indexOf('prefers-reduced-motion'))
  assert.match(reduced, /animation-duration: 0\.01ms !important/)
  assert.match(reduced, /transition-duration: 0\.01ms !important/)
  assert.match(reduced, /\.spinner \{ animation: none/)
})

test('every animation it defines is covered by that rule', () => {
  const styles = page.slice(page.indexOf('<style>'), page.indexOf('</style>'))
  const animated = [...styles.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1])

  // One animation, and it is the one turned off above.
  assert.deepEqual([...new Set(animated)].filter((name) => name !== 'none'), ['spin'])
})

test('keyboard focus is visible', () => {
  assert.match(page, /:focus-visible/)
  assert.match(page, /outline: 2px solid var\(--focus\)/)
  assert.match(page, /outline-offset/)
})

test('it survives forced colours and printing', () => {
  assert.match(page, /@media \(forced-colors: active\)/)
  assert.match(page, /@media print/)
})

test('it scales rather than fixing sizes it cannot know', () => {
  assert.match(page, /clamp\(/)
  assert.match(page, /-webkit-text-size-adjust: 100%/)
  assert.ok(!/font-size:\s*\d+px/.test(page), 'a pixel font size will not scale with the reader’s setting')
})

test('long hashes wrap instead of pushing the page sideways', () => {
  // A content address on a phone is wider than the screen.
  assert.match(page, /overflow-wrap: anywhere/)
})

test('the outcome of each check is stated, not only coloured', () => {
  // Colour alone fails a reader who cannot see it, and the ticks are marked
  // decorative precisely so the words carry the meaning.
  assert.match(page, /aria-hidden="true"/)
  assert.match(page, /visually-hidden/)
  assert.match(page, /role="status"/)
  assert.match(page, /aria-live="polite"/)
})

test('the status region exists before it has anything to say', () => {
  // An aria-live region inserted along with its message is often not announced.
  const statusIndex = page.indexOf('id="status"')
  assert.ok(statusIndex > 0)
  assert.ok(statusIndex < page.indexOf('<script'), 'the live region is created by script')
})

test('it never asks the server for the verdict', () => {
  // The whole point. The page fetches evidence and does the arithmetic.
  assert.match(page, /checkDraw\(draw\)/)
  assert.ok(!/verdict.*=.*payload\./.test(page), 'the page takes a verdict from the response')
})

test('nothing from the server is written as markup', () => {
  // Draw data is attacker-adjacent: a class name and a selected value come
  // from records. textContent throughout, no innerHTML anywhere.
  assert.ok(!/innerHTML/.test(page), 'the page assigns innerHTML')
  assert.ok(!/insertAdjacentHTML/.test(page))
  assert.match(page, /textContent/)
})

test('the school name it is given cannot become markup', () => {
  const hostile = verifyPageHtml({ schoolName: '</title><script>alert(1)</script>' })

  assert.ok(!hostile.includes('<script>alert(1)</script>'))
  assert.match(hostile, /&lt;script&gt;/)
})

test('every locale ray renders, in its own language', async () => {
  const { LOCALES } = await import('../i18n/index.js')

  for (const { code } of LOCALES) {
    const rendered = verifyPageHtml({ locale: code })
    assert.match(rendered, new RegExp(`<html lang="${code}">`), `${code} does not declare itself`)
    assert.ok(rendered.includes('<title>'), `${code} has no title`)
  }
})

test('no ray is missing a phrase', async () => {
  // A missing key renders the word "undefined" at a parent, in the one place
  // they came to read an answer. Every ray carries every phrase the English
  // one does, or this fails naming the ray and the key.
  const { LOCALES } = await import('../i18n/index.js')
  const copyOf = (locale: string) =>
    JSON.parse(
      verifyPageHtml({ locale: locale as never }).match(/const COPY = (\{.*?\})\nconst DATA_URL/s)![1]!,
    ) as Record<string, string>

  const reference = Object.keys(copyOf('en')).sort()

  for (const { code } of LOCALES) {
    const keys = Object.keys(copyOf(code)).sort()
    assert.deepEqual(keys, reference, `${code} does not carry the same phrases as en`)

    for (const [key, value] of Object.entries(copyOf(code))) {
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${code}.${key} is empty`)
    }
  }
})

test('a ray is actually translated, not the English copied across', async () => {
  // Seven identical pages would pass every structural check above.
  const { LOCALES } = await import('../i18n/index.js')
  const english = verifyPageHtml({ locale: 'en' })

  for (const { code } of LOCALES.filter((l) => l.code !== 'en')) {
    const rendered = verifyPageHtml({ locale: code })
    assert.notEqual(rendered, english, `${code} is the English page`)
    assert.ok(!rendered.includes('Verify a draw'), `${code} still carries the English heading`)
  }
})

test('a failed load offers a way out rather than a spinner forever', () => {
  assert.match(page, /COPY\.problem/)
  assert.match(page, /COPY\.retry/)
  assert.match(page, /location\.reload\(\)/)
})

test('an empty class is a sentence, not a blank page', () => {
  assert.match(page, /draws\.length === 0/)
  assert.match(page, /COPY\.empty/)
})

test('a withheld outcome is explained where the answer is', () => {
  assert.match(page, /COPY\.notPublished/)
})

// --- what it refuses -----------------------------------------------------

test('the data endpoint refuses an unauthenticated reader', async () => {
  const data = verifyEndpoints().find((e) => e.path === '/school/verify/data')!
  const response = (await data.handler({
    url: 'http://x/api/school/verify/data',
    user: null,
  } as never)) as Response

  assert.equal(response.status, 401)
})

test('the page itself carries a policy that lets nothing else run', async () => {
  const doc = verifyEndpoints().find((e) => e.path === '/school/verify')!
  const response = (await doc.handler({ url: 'http://x/api/school/verify' } as never)) as Response
  const policy = response.headers.get('content-security-policy') ?? ''

  assert.match(policy, /default-src 'none'/)
  assert.match(policy, /connect-src 'self'/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('a parent’s draws are never cached by anything in between', async () => {
  const data = verifyEndpoints().find((e) => e.path === '/school/verify/data')!
  const response = (await data.handler({
    url: 'http://x/api/school/verify/data',
    user: null,
  } as never)) as Response

  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('the data endpoint answers from the same handler the tool uses', async () => {
  // One code path, so a parent opening a link and an auditor calling the tool
  // get the same reads and the same class confinement.
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const source = readFileSync(resolve(process.cwd(), 'src/ui/endpoints.ts'), 'utf8')

  assert.match(source, /fairnessMcpTools/)
  assert.ok(!/findAll|payload\.find/.test(source), 'the endpoint reads records on its own')
})

test('each mount path moves its own data endpoint with it', () => {
  const moved = verifyEndpoints({ discoverPath: '/opportunities', path: '/check' })

  assert.deepEqual(moved.map((e) => e.path), [
    '/check',
    '/check/data',
    '/opportunities',
    '/opportunities/data',
  ])
})
