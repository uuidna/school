import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url)).replace(/\/dist\//, '/src/')

/** Every plugin this package ships, as files rather than as a list somebody keeps. */
const pluginSources = (): { name: string; text: string }[] => {
  const out: { name: string; text: string }[] = []
  for (const entry of readdirSync(HERE, { withFileTypes: true })) {
    const path = entry.isDirectory() ? join(HERE, entry.name, 'index.ts') : join(HERE, entry.name)
    if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue
    try {
      out.push({ name: entry.name, text: readFileSync(path, 'utf8') })
    } catch {
      // a directory with no index.ts is not a plugin
    }
  }
  return out
}

test('every plugin is typed by Payload\'s own Plugin, not by a shape we restate', () => {
  const offenders: string[] = []
  for (const { name, text } of pluginSources()) {
    // A PLUGIN IS WHAT IT EXPORTS, not what it mentions. The first cut of this
    // asked whether a file said "Plugin" anywhere, and flagged collections.ts —
    // a helper two plugins call, which names the word in its prose and is not
    // a plugin. A guard whose subject is decided by prose is reading the
    // comments, which is the failure mode this package keeps finding in itself.
    const factories = [...text.matchAll(/^export const (\w*Plugin) =/gm)].map((m) => m[1]!)
    if (factories.length === 0) continue
    if (!/\): Plugin =>/.test(text)) offenders.push(`${name} exports ${factories.join(', ')} and never annotates with Payload's Plugin`)
  }
  assert.deepEqual(offenders, [], 'annotate the factory `: Plugin` and let Payload supply the rest')
})

// THE PARAPHRASE IS THE DEFECT, and it is invisible until the library moves.
// Payload 4 added `slug` to AccessArgs and fifteen call sites failed with one
// message fifteen times, because a test had copied `{ req: PayloadRequest }`
// instead of deriving it. The plugins carried the same shape: annotated
// `: Plugin`, and then restating `(config: Config): Config` on the very next
// line — a second, older opinion about a signature Payload already owns, free
// to disagree with it on the next release. One source or none.
test('no plugin restates the config signature Plugin already supplies', () => {
  const offenders: string[] = []
  for (const { name, text } of pluginSources()) {
    const restated = /\): Plugin =>\s*\n\s*(?:async )?\(config: Config\)/.test(text)
    if (restated) offenders.push(name)
  }
  assert.deepEqual(
    offenders,
    [],
    'write `(config) =>` and let the `: Plugin` annotation type it — a paraphrase can only ever go stale',
  )
})

test('the guard can see a restatement when there is one', () => {
  // The control. A guard that has never seen the thing it forbids is a guard
  // nobody has tested, and this package has shipped two of those.
  const planted = 'export const x =\n  (o = {}): Plugin =>\n  (config: Config): Config => config\n'
  assert.equal(/\): Plugin =>\s*\n\s*(?:async )?\(config: Config\)/.test(planted), true)

  const folded = 'export const x =\n  (o = {}): Plugin =>\n  (config) => config\n'
  assert.equal(/\): Plugin =>\s*\n\s*(?:async )?\(config: Config\)/.test(folded), false)
})
