import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CATALOGUE } from './discovery.js'
import { PAYLOAD_REACHING, isPublicTool } from './registry.js'

const HERE = dirname(fileURLToPath(import.meta.url)).replace(/\/dist\//, '/src/')

/** Direct evidence that a handler touches the store. */
const TOUCHES_PAYLOAD = /req\.payload\b|resolveSource\s*\(|payload\.(?:find|create|update|delete)\b/

/**
 * Each tool with the source text of its own entry — from its `name:` line to
 * the next tool's, which is where a handler lives.
 */
const scanned = (): { name: string; reaches: boolean }[] => {
  const rows: { name: string; reaches: boolean }[] = []
  for (const file of readdirSync(HERE)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const text = readFileSync(join(HERE, file), 'utf8')
    const marks = [...text.matchAll(/name: '(school_[a-z_]+)'/g)]
    for (let i = 0; i < marks.length; i++) {
      const body = text.slice(marks[i]!.index, i + 1 < marks.length ? marks[i + 1]!.index : text.length)
      rows.push({ name: marks[i]![1]!, reaches: TOUCHES_PAYLOAD.test(body) })
    }
  }
  return rows
}

// THE GUARD THAT WOULD HAVE CAUGHT IT. `isPublicTool` first read `needs`, which
// declares what a tool wants of the SOURCE ADAPTER and says nothing about
// Payload. Two tools declared nothing and called `req.payload` directly, so the
// public set contained two store-reaching tools and the test passed — because
// it checked a declaration against itself. This checks the handlers.
test('no tool reaches Payload while being absent from PAYLOAD_REACHING', () => {
  const missing = scanned().filter((r) => r.reaches && !PAYLOAD_REACHING.includes(r.name)).map((r) => r.name)
  assert.deepEqual(missing, [], 'these handlers call Payload and are not listed — add them, or they become publicly callable')
})

test('the scan sees Payload when it is there — the reader is not broken', () => {
  // A scan that matches nothing would report an empty `missing` and pass while
  // proving nothing. This package has shipped two checks like that.
  const rows = scanned()
  assert.ok(rows.length >= 25, `the scan found ${rows.length} tools`)
  assert.ok(rows.some((r) => r.reaches), 'the scan can see a Payload call')
  assert.ok(rows.some((r) => !r.reaches), 'and can see a handler without one')
})

test('nothing in the public set reaches Payload by direct evidence', () => {
  const reaching = new Map(scanned().map((r) => [r.name, r.reaches]))
  for (const tool of CATALOGUE.filter(isPublicTool)) {
    assert.equal(reaching.get(tool.name), false, `${tool.name} is public and its handler names Payload`)
  }
})

// ABSENCE IS NOT PROOF, and the code says so where it matters. A handler may
// reach Payload through a helper this scan cannot follow, so the public door
// must also deny Payload rather than trust this list to be complete.
test('the public set is small, and shrinking it is always safe', () => {
  const open = CATALOGUE.filter(isPublicTool).map((t) => t.name).sort()
  assert.deepEqual(open, [
    'school_compliance_report',
    'school_financing_opportunities',
    'school_national_programmes',
    'school_researcher_financing',
  ])
  assert.ok(open.length < CATALOGUE.length / 4, 'public is the exception, not the default')
})
