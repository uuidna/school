import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

import { GRANTABLE_ROLES } from './access/roles.js'
import * as mcp from './mcp/index.js'
import * as plugins from './plugins/index.js'
import { JURISDICTIONS, SPECIALTIES } from './packs/index.js'

// THE README IS A CLAIM ABOUT THIS CODE, so it is checked against it.
//
// A fix to the discovery endpoint was once reported in a commit message and in
// a summary, and never applied: the edit's anchor had stopped matching after an
// unrelated change, and the replacement silently did nothing. Nothing noticed,
// because prose is not executed.
//
// Every number and name the README states about the code is now read back out
// of the code. A claim that stops being true fails the build rather than
// waiting to be believed by somebody.

const ROOT = resolve(process.cwd())
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/**
 * Read from the same table the sync script writes with.
 *
 * A second copy of the number words lived here and stopped at seventeen, so
 * the moment the tool count reached nineteen this guard failed while the
 * README was correct — and blamed the README. One table now.
 */
const { fromWord } = (await import(
  `${pathToFileURL(join(ROOT, 'scripts/readme-facts.mjs')).href}`
)) as { fromWord: (raw: string) => number }

const statedCount = (pattern: RegExp): number | undefined => {
  const match = README.match(pattern)
  if (!match?.[1]) return undefined
  const parsed = fromWord(match[1])
  return Number.isNaN(parsed) ? undefined : parsed
}

test('the README states a tool count, and it is the real one', () => {
  // Every exported tool array, not a list to keep in step. Enumerating the
  // modules meant a new one drifted silently: adding the calendar tools made
  // this count stale while the README was correct, and it blamed the README.
  const isTool = (entry: unknown): boolean => {
    const tool = entry as { allowedRoles?: unknown; name?: unknown; writes?: unknown }
    return (
      typeof tool?.name === 'string' &&
      Array.isArray(tool.allowedRoles) &&
      typeof tool.writes === 'boolean'
    )
  }

  const actual = (Object.values(mcp) as unknown[])
    .filter((value) => Array.isArray(value) && value.length > 0 && value.every(isTool))
    .flat().length

  assert.ok(actual > 10, `expected the package's tools, counted ${actual}`)

  const stated = statedCount(/([\w-]+) tools, each declaring/i)
  assert.ok(stated !== undefined, 'the README no longer states a tool count')
  assert.equal(stated, actual, 'run: npm run docs:sync')
})

test('the README states a role count, and it is the real one', () => {
  const stated = statedCount(/([\w-]+) roles — /u)
  assert.ok(stated !== undefined, 'the README no longer states a role count')
  // Four grantable, plus parent, which is derived rather than granted.
  assert.equal(stated, GRANTABLE_ROLES.length + 1)
})

test('the README states a test count, and it is the real one', () => {
  const count = (dir: string): number => {
    let n = 0
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) n += count(full)
      else if (entry.endsWith('.test.ts')) {
        n += (readFileSync(full, 'utf8').match(/^test\(/gm) ?? []).length
      }
    }
    return n
  }

  const stated = statedCount(/(\d+) tests, no test dependencies/)
  assert.ok(stated !== undefined, 'the README no longer states a test count')
  assert.equal(stated, count(join(ROOT, 'src')), 'run: npm run docs:sync')
})

test("the README's own examples resolve to packs that ship", () => {
  // Not the prose around them — the calls themselves, so a documented snippet
  // cannot quietly stop working.
  const jurisdictions = [...README.matchAll(/jurisdictionFor\('([a-z-]+)'\)/g)].map((m) => m[1]!)
  const specialties = [...README.matchAll(/specialtyFor\('([a-z-]+)'\)/g)].map((m) => m[1]!)

  assert.ok(jurisdictions.length > 0, 'the README stopped showing a jurisdiction')
  assert.ok(specialties.length > 0, 'the README stopped showing a specialty')

  for (const code of jurisdictions) {
    assert.ok(code in JURISDICTIONS, `jurisdictionFor('${code}') is documented but absent`)
  }
  for (const code of specialties) {
    assert.ok(code in SPECIALTIES, `specialtyFor('${code}') is documented but absent`)
  }
})

test('the README does not claim parent can be granted', () => {
  assert.match(README, /`parent` cannot be granted/)
  assert.equal(GRANTABLE_ROLES.includes('parent'), false)
})

test('every environment variable the README names is read somewhere', () => {
  // A documented switch nobody reads is a switch that does nothing.
  const sources: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        sources.push(readFileSync(full, 'utf8'))
      }
    }
  }
  walk(join(ROOT, 'src'))
  const all = sources.join('\n')

  const named = new Set(
    (README.match(/`(SCHOOL_[A-Z_]+|MCP_API_KEY)[^`]*`/g) ?? []).map((m) =>
      m.replace(/`/g, '').split('=')[0]!.trim(),
    ),
  )

  assert.ok(named.size > 0, 'the README stopped naming its environment variables')
  for (const name of named) {
    assert.ok(all.includes(name), `${name} is documented but read nowhere`)
  }
})

test('every exported name the README tells people to import exists', () => {
  const imports = README.match(/import \{([^}]+)\} from '@uuidna\/school[^']*'/g) ?? []
  assert.ok(imports.length > 0, 'the README stopped showing any imports')

  const named = imports.flatMap((block) =>
    block
      .replace(/import \{|\} from .*/g, '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )

  const sources: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        sources.push(readFileSync(full, 'utf8'))
      }
    }
  }
  walk(join(ROOT, 'src'))
  const all = sources.join('\n')

  for (const name of named) {
    assert.match(all, new RegExp(`export (?:const|function|async function|type) ${name}\\b`), `${name} is documented but not exported`)
  }
})

/**
 * The counts the README states about parts of itself.
 *
 * Three numbers were hand-written and all three were wrong when audited: the
 * financing section said "Three tools" with five beside it, the CSS section
 * said four tests with eight, and the test section said seven source-scanning
 * guards where there were twenty-six. Each was true when written. None was
 * recomputed, because a sentence is not executed — which is the failure this
 * whole file exists for, appearing inside the file itself.
 */
const FACTS = (await import(
  `${pathToFileURL(join(ROOT, 'scripts/readme-facts.mjs')).href}`
)) as unknown as { facts: (root: string) => Record<string, number> }

test('every count the README states about a part of itself is the real one', () => {
  const real = FACTS.facts(ROOT)

  const stated: [string, number | undefined, number][] = [
    ['financing tools', statedCount(/([\w-]+) tools\. `school_financing_opportunities`/), real.financingTools!],
    ['CSS guards', statedCount(/([\w-]+) tests keep it that way/), real.cssTests!],
    ['source-scanning tests', statedCount(/([\w-]+) of them read the \*\*source tree\*\*/), real.scanningTests!],
  ]

  for (const [what, said, actual] of stated) {
    assert.ok(said !== undefined, `the README no longer states a count of ${what}`)
    assert.equal(said, actual, `${what}: run npm run docs:sync`)
  }
})

test('the README does not promise an install that does not work', () => {
  // The registry answers 404. The install line stays, because it is what
  // installing will look like — but the reader is told before their terminal
  // tells them.
  if (/npm install @uuidna\/school/.test(README)) {
    assert.match(
      README,
      /\*\*Not on npm yet\.\*\*/,
      'the README shows an npm install without saying the package is not published',
    )
  }
})

test('what the README says about the Bulgarian ages is what the pack states', () => {
  // It described the digital-consent age as deliberately blank for as long as
  // it was blank, and went on describing it that way after the figure was
  // established from ЗЗЛД чл. 25в.
  const bg = JURISDICTIONS.bg!
  const stated = README.match(/majority (\d+) and a\s+digital-consent\s+age of (\d+)/)

  assert.ok(stated, 'the README no longer states the Bulgarian ages')
  assert.equal(Number(stated[1]), bg.ages?.majority)
  assert.equal(Number(stated[2]), bg.ages?.digitalConsent)
})

test('every plugin the package ships is one the README lists', () => {
  // A plugin with no entry is a plugin a host does not know to wire, which is
  // how a collection gets read that nothing creates.
  const shipped = Object.keys(plugins).filter((name) => /Plugin$/.test(name))
  assert.ok(shipped.length > 4, `expected the package's plugins, found ${shipped.length}`)

  const unlisted = shipped.filter(
    (name) => name !== 'schoolPlugin' && !README.includes(`\`${name}\``),
  )

  assert.deepEqual(unlisted, [], 'these plugins ship and the README does not mention them')
})
