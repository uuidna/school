import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

import { LOCALES } from './index.js'
import { ADMIN_KEYS, describe } from './admin.js'

// A MISSING RAY RENDERS AN EMPTY HINT at the moment somebody needs it, beside
// the field they are unsure about. Seven rays or it fails, naming the key and
// the language — the same rule the two public pages are held to.

const SRC = resolve(process.cwd(), 'src')
const rays = LOCALES.map((locale) => locale.code)

const sources = (dir = SRC, acc: { path: string; text: string }[] = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sources(full, acc)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push({ path: relative(SRC, full), text: readFileSync(full, 'utf8') })
    }
  }
  return acc
}

test('every key carries every ray', () => {
  for (const key of ADMIN_KEYS) {
    const entry = describe(key)
    for (const ray of rays) {
      assert.ok(entry[ray], `${key} has no ${ray}`)
      assert.ok(entry[ray]!.trim().length > 0, `${key}.${ray} is empty`)
    }
  }
})

test('no key carries a ray that is not one of the seven', () => {
  // An eighth would render for nobody and hide a missing one.
  for (const key of ADMIN_KEYS) {
    assert.deepEqual(Object.keys(describe(key)).sort(), [...rays].sort(), `${key} has the wrong rays`)
  }
})

test('a ray is a translation, not the English copied across', () => {
  // Seven identical strings would pass every check above.
  for (const key of ADMIN_KEYS) {
    const entry = describe(key)
    const copied = rays.filter((ray) => ray !== 'en' && entry[ray] === entry.en)

    assert.deepEqual(copied, [], `${key} is the English text in ${copied.join(', ')}`)
  }
})

test('the table is actually used, not merely defined', () => {
  const all = sources()
    .filter((file) => !file.path.startsWith('i18n/'))
    .map((file) => file.text)
    .join('\n')

  const used = ADMIN_KEYS.filter((key) => all.includes(`describe('${key}')`))
  const unused = ADMIN_KEYS.filter((key) => !used.includes(key))

  assert.ok(used.length > 0, 'nothing uses the table')
  // A key nobody calls is a translation nobody reads.
  assert.deepEqual(unused, [], 'these keys are translated and never used')
})

test('no field help is written in one language at a call site', () => {
  // The whole point of the table: a description inline is a description in
  // whatever language its author spoke.
  const offenders: string[] = []

  for (const file of sources()) {
    if (file.path.startsWith('i18n/')) continue
    for (const match of file.text.matchAll(/description:\s*\n?\s*'([^']{12,})'/g)) {
      offenders.push(`${file.path}: ${match[1]!.slice(0, 44)}…`)
    }
  }

  // MCP tool descriptions are read by an agent, not by a person in a panel,
  // and stay in one language on purpose.
  const inPanel = offenders.filter((entry) => !entry.startsWith('mcp/'))

  assert.deepEqual(inPanel, [], 'these render in the admin panel in one language')
})
