import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CATALOGUE } from './discovery.js'
import { isPublicTool } from './registry.js'

/**
 * THE RULE IS STRUCTURAL, so these hold it to the structure rather than to a
 * list somebody keeps. What reaches the school's own system is private; what
 * reaches nothing is public; a write is never public.
 */
test('a tool that needs a capability is private, whatever it is called', () => {
  for (const tool of CATALOGUE) {
    if ((tool.needs?.length ?? 0) > 0) {
      assert.equal(isPublicTool(tool), false, `${tool.name} reaches ${tool.needs!.join('+')} and must not be public`)
    }
  }
})

test('a write is never public, even reaching nothing', () => {
  // Two catalogue loaders reach no capability and still record what they
  // fetched. Reading a public record is public; making the school hold one is not.
  const writingButNeedsNothing = CATALOGUE.filter((t) => (t.needs?.length ?? 0) === 0 && t.writes === true)
  assert.ok(writingButNeedsNothing.length > 0, 'the case exists in this catalogue')
  for (const tool of writingButNeedsNothing) {
    assert.equal(isPublicTool(tool), false, `${tool.name} writes`)
  }
})

// THIS ASSERTION WAS WRONG, and is kept in its corrected form as the record.
// It listed six tools, two of which — school_financing_plan and
// school_verify_class_draw — call `req.payload` directly. It passed anyway,
// because the rule it checked read `needs`, and `needs` declares what a tool
// wants of the SOURCE ADAPTER, not whether it touches Payload. A test that
// compares a declaration with itself agrees with itself. reach.test.ts checks
// the handlers instead.
test('the public set reaches no Payload, needs nothing, and writes nothing', () => {
  const publicNames = CATALOGUE.filter(isPublicTool).map((t) => t.name).sort()
  assert.deepEqual(publicNames, [
    'school_compliance_report',
    'school_financing_opportunities',
    'school_national_programmes',
    'school_researcher_financing',
  ])
})

test('the two that slipped through are private, and named so they stay named', () => {
  const by = new Map(CATALOGUE.map((t) => [t.name, t]))
  assert.equal(isPublicTool(by.get('school_financing_plan')!), false)
  assert.equal(isPublicTool(by.get('school_verify_class_draw')!), false)
})

// THE ONES A HAND-PICKED LIST GOT WRONG, kept as a standing control: both look
// like things a school publishes, and both reach the store to answer.
test('tools that merely SOUND public are private, because they reach the store', () => {
  const by = new Map(CATALOGUE.map((t) => [t.name, t]))
  assert.equal(isPublicTool(by.get('school_legal_publication_status')!), false, 'reads the school documents')
  assert.equal(isPublicTool(by.get('school_calendar')!), false, 'reads the school calendar')
  assert.equal(isPublicTool(by.get('school_fairness_audit')!), false, 'reads the selection trail')
})

test('no tool touching a person is public', () => {
  const personal = ['people', 'peopleWritable', 'rosters', 'audit'] as const
  for (const tool of CATALOGUE) {
    if ((tool.needs ?? []).some((n) => (personal as readonly string[]).includes(n))) {
      assert.equal(isPublicTool(tool), false, `${tool.name} touches a person`)
    }
  }
})
