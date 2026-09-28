import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clean, LookedAtNothing, report, unasked } from './evidence.js'

/**
 * THE WHOLE POINT, in one assertion: a census of zero is NOT a clean census. Every instance in the docblock is
 * this — a mutation runner on a red suite, a secret scanner in an empty repository, a trap suite pointed at a
 * missing directory. Each returned the strongest word its tool had.
 */
test('an empty census throws rather than reporting clean', () => {
  assert.throws(() => clean({ of: 'secrets', at: 0, findings: [] }), LookedAtNothing)
  assert.throws(() => report({ of: 'secrets', at: 0, findings: [] }), LookedAtNothing)
})

/**
 * AND IT DOES NOT RETURN FALSE EITHER. False would send a caller looking for a defect that does not exist. The
 * honest third answer is that the question was not asked, which is why this throws instead of answering.
 */
test('the refusal says the search did not happen, not that something is broken', () => {
  try {
    clean({ of: 'wings', at: 0, findings: [] })
    assert.fail('expected a refusal')
  } catch (e) {
    assert.ok(e instanceof LookedAtNothing)
    assert.match(e.message, /absence of a search/)
    assert.doesNotMatch(e.message, /failed|broken|invalid/)
  }
})

test('a real census answers cleanly or names its findings', () => {
  assert.equal(clean({ of: 'files', at: 412, findings: [] }), true)
  assert.equal(clean({ of: 'files', at: 412, findings: ['leaked key'] }), false)
})

/**
 * THE DENOMINATOR TRAVELS WITH THE VERDICT. "no secrets committed" and "no secrets committed across 412 files"
 * are different claims and only one can be checked, so a reader never has to go and find the count.
 */
test('the report carries what it looked at', () => {
  assert.match(report({ of: 'secrets', at: 412, findings: [] }), /clean across 412/)
  assert.match(report({ of: 'secrets', at: 412, findings: ['x', 'y'] }), /2 finding\(s\) across 412/)
})

/** A negative or non-integer census is a broken instrument, not a clean one. */
test('a census that is not a count is refused', () => {
  assert.throws(() => clean({ of: 'x', at: -1, findings: [] }), LookedAtNothing)
  assert.throws(() => clean({ of: 'x', at: 1.5, findings: [] }), LookedAtNothing)
})

/** An absent instrument VOIDS a result rather than agreeing with it. */
test('unasked is distinguishable from clean at a glance', () => {
  const u = unasked('prior art', 'the registry answered 429')
  assert.match(u, /UNASKED/)
  assert.match(u, /not a clean result/)
  assert.doesNotMatch(u, /^✓/)
})
