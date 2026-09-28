#!/usr/bin/env node
/**
 * Rewrites the numbers the README states about this code.
 *
 * The README's claims are checked against the source, which is right — a
 * documented count that drifts is a documented lie. But the check alone made
 * every change a two-step: edit, watch the guard fail, hand-fix the number.
 * That was done three times before it became obvious that a correction
 * repeated is a correction that should be computed.
 *
 * The guard stays and the fix is automatic. It still fires when sync cannot
 * help, which is what keeps the two honest about each other. Both read their
 * numbers from `readme-facts.mjs`, because two tables answering one question
 * is how they disagreed in the first place.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { applyFacts, facts } from './readme-facts.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const path = join(ROOT, 'README.md')

const before = readFileSync(path, 'utf8')
const counted = facts(ROOT)
const after = applyFacts(before, counted)

if (after === before) {
  console.log('README already matches the code')
} else {
  writeFileSync(path, after)
  console.log(`README synced: ${counted.tests} tests, ${counted.tools} tools, ${counted.roles} roles`)
}
