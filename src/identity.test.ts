import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { identityMatches, identityOf, Unstamped } from './identity.js'

const at = (contents: string): URL => {
  const f = join(mkdtempSync(join(tmpdir(), 'ident-')), 'identity.json')
  writeFileSync(f, contents)
  return pathToFileURL(f)
}

test('a stamped build states what it is', () => {
  const id = identityOf()
  assert.equal(id.name, '@uuidna/school')
  assert.match(id.dist, /^[0-9a-f]{64}$/)
  assert.ok(id.files > 0)
  assert.equal(typeof id.version, 'string')
})

/**
 * THE PIN IS ON THE ADDRESS, NOT THE VERSION. A version can be republished over different bytes; an address
 * cannot. A consumer pinning the version would pin a name, and a name is exactly what a `file:` dependency
 * already fails to give them.
 */
test('a pin matches its own build and nothing else', () => {
  const id = identityOf()
  assert.equal(identityMatches(id.dist), true)
  assert.equal(identityMatches('0'.repeat(64)), false)
})

/**
 * AN UNSTAMPED BUILD REFUSES RATHER THAN GUESSES, and the refusal is exercised rather than asserted. An
 * identity invented for an unstamped build would be pinnable and meaningless — the one outcome worse than
 * having no identity at all.
 */
test('an unstamped or malformed build refuses, and a pin against it fails closed', () => {
  const missing = pathToFileURL(join(tmpdir(), 'no-such-dir-' + String(Date.now()), 'identity.json'))
  assert.throws(() => identityOf(missing), Unstamped)
  assert.throws(() => identityOf(at('not json at all')), Unstamped)
  assert.throws(() => identityOf(at('{"version":"1.0.0"}')), Unstamped)          // no dist address
  assert.throws(() => identityOf(at('{"dist":"","version":"1.0.0"}')), Unstamped) // empty address
  // a pin must fail CLOSED: unanswered is not a match
  assert.equal(identityMatches('anything', missing), false)
})

/** The reason travels with the refusal, so a consumer sees what to do rather than that something went wrong. */
test('the refusal names why', () => {
  try {
    identityOf(at('{"version":"1.0.0"}'))
    assert.fail('expected a refusal')
  } catch (e) {
    assert.ok(e instanceof Unstamped)
    assert.match(e.message, /no dist address/)
    assert.match(e.message, /stamp-identity/)
  }
})
