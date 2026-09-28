import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)).replace(/\/dist\//, '/src/')
const SRC = join(HERE, '..')

/**
 * EVERY TOOL HAS A TEST THAT NAMES IT, and the count may only go down.
 *
 * A tool covered only by an aggregate fold is not untested — it is UNDER-tested,
 * and the difference is invisible until the fold passes for a reason that has
 * nothing to do with the tool. Six sat in that state, two of them the statutory
 * reports an inspection actually opens, and one of those — the document
 * recorder — WRITES.
 *
 * Nothing here asserts a tool is correct. It asserts that somebody wrote down
 * what correct would mean.
 */
const read = (dir: string, out: { path: string; text: string }[] = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) read(path, out)
    else if (path.endsWith('.ts')) out.push({ path, text: readFileSync(path, 'utf8') })
  }
  return out
}

const files = read(SRC)
// A FILE IS NEVER ITS OWN WITNESS. This one names a tool that does not exist in
// order to prove the reader can tell absence from presence — and if its own text
// is in the corpus, that name is found and the control passes for the worst
// possible reason. Excluding it is the difference between a control and a
// tautology.
const SELF = fileURLToPath(import.meta.url).replace(/\/dist\//, '/src/').replace(/\.js$/, '.ts')

const tests = files
  .filter((f) => f.path.endsWith('.test.ts') && f.path !== SELF)
  .map((f) => f.text)
  .join('\n')
const doors = files
  .filter((f) => f.path.includes('/mcp/') && !f.path.endsWith('.test.ts'))
  .map((f) => f.text)
  .join('\n')

const tools = [...new Set([...doors.matchAll(/name: '(school_[a-z_]+)'/g)].map((m) => m[1]!))].sort()

test('every declared tool is named by some test', () => {
  const untested = tools.filter((tool) => !tests.includes(tool))
  assert.deepEqual(
    untested,
    [],
    'write a test that names each and checks its answer — an aggregate fold is not coverage of a tool',
  )
})

// CONTROLS BOTH WAYS. A reader that found no tools would report an empty gap
// and pass while proving nothing; one that matched everything would never fail.
test('the reader sees the tools and can tell a missing one from a present one', () => {
  assert.ok(tools.length >= 25, `found ${tools.length} tools`)
  assert.ok(tests.length > 10_000, 'and it is reading the tests, not an empty string')
  assert.equal(['school_not_a_real_tool'].filter((t) => !tests.includes(t)).length, 1, 'an absent name reports absent')
  assert.equal(['school_access_review'].filter((t) => !tests.includes(t)).length, 0, 'a present one does not')
})
