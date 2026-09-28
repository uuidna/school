import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assess } from './assess.js'
import { byFramework, byTheme, EU_FRAMEWORK, EU_THEME } from './themes.js'
import { loadEuProgrammes } from './eu.js'

// THIS FINDS FUNDING. It does not say a school may take children anywhere, and
// these tests pin that boundary as much as the queries: a grant identifier is
// not a permission, and the compliance engine must not learn otherwise.

const portal = (results: Record<string, unknown>[]) => {
  const sent: string[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    sent.push(String(init?.body ?? ''))
    return Response.json({ results, totalResults: results.length })
  }
  return { fetch, sent }
}

const topic = (id: string) => ({
  metadata: {
    callIdentifier: [id],
    identifier: [id],
    language: ['en'],
    title: [`Call ${id}`],
  },
  reference: id,
})

test('a theme narrows to the calls it names', async () => {
  const { fetch, sent } = portal([topic('LIFE-2026-SAP-NAT-GOV')])
  await loadEuProgrammes({ fetch: fetch as never, pageSize: 50, ...byTheme('nature') })

  for (const call of EU_THEME.nature) assert.ok(sent[0]!.includes(call), `${call} was not asked for`)
})

test('the table holds callIdentifier values, not topic identifiers', async () => {
  // The first version was built from what a console log printed — the topic
  // identifier — and matched nothing, because the query is on callIdentifier.
  // A LIFE call identifier has four segments at most; a topic has more.
  for (const calls of Object.values(EU_THEME)) {
    for (const call of calls) {
      assert.ok(call.split('-').length <= 4, )
    }
  }
})

test('the three themes are distinct, not one list under three names', async () => {
  const all = [...EU_THEME.nature, ...EU_THEME.climate, ...EU_THEME.environment]
  assert.equal(new Set(all).size, all.length, 'a call appears under more than one theme')
})

test('a framework query uses a code that was read from the portal', async () => {
  // 43252405 was confirmed live: 5,105 records, every one a LIFE call. A code
  // nobody checked returns a plausible list of the wrong calls, silently.
  assert.equal(EU_FRAMEWORK.life, '43252405')
  assert.deepEqual(byFramework('life').must, [{ terms: { frameworkProgramme: ['43252405'] } }])
})

test('every theme names calls from a framework this table knows', async () => {
  for (const [theme, calls] of Object.entries(EU_THEME)) {
    for (const call of calls) {
      assert.match(call, /^LIFE-/, `${theme} names ${call}, which is not a LIFE call`)
    }
  }
})

test('a themed programme still claims no eligibility', async () => {
  // The whole point of the boundary: finding a nature call tells a school the
  // money exists, not that it qualifies, and certainly not that it may take
  // children to a protected site.
  const { fetch } = portal([topic('LIFE-2026-SAP-NAT-GOV')])
  const [programme] = await loadEuProgrammes({ fetch: fetch as never, pageSize: 50, ...byTheme('nature') })

  const verdict = await assess(programme!, { jurisdiction: 'bg', kind: 'institution' })
  assert.equal(verdict.eligible, undefined)
  assert.match(verdict.undecidable[0]!.reason, /prose/)
})

test('themes are a query, not a compliance claim', async () => {
  // If this module ever imports the compliance engine, a funding filter has
  // started answering a legal question.
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const source = readFileSync(resolve(process.cwd(), 'src/financing/themes.ts'), 'utf8')

  // Imports, not prose: the docstring says what this module is not, and
  // matching on the word would flag it for saying so.
  const imports = [...source.matchAll(/^import .*$/gm)].map((m) => m[0]).join('\n')

  assert.ok(!/compliance|packs|jurisdiction/i.test(imports), `themes.ts imports: ${imports}`)
  assert.ok(!/LEGAL_PUBLICATIONS|jurisdictionFor\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')))
})
