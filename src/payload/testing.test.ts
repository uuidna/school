import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fakePayload, fakeRequest } from './testing.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)).replace(/\/dist\//, '/src/'), '..')

test('the fake answers what this package actually asks Payload', async () => {
  const { calls, payload } = fakePayload({ docs: { pages: [{ id: 7, slug: 'a' }] } })
  const p = payload as unknown as {
    count: (a: { collection: string }) => Promise<{ totalDocs: number }>
    create: (a: { collection: string; data: Record<string, unknown> }) => Promise<unknown>
    find: (a: { collection: string }) => Promise<{ docs: unknown[] }>
    findVersions: () => Promise<{ docs: unknown[] }>
  }

  assert.equal((await p.find({ collection: 'pages' })).docs.length, 1)
  assert.equal((await p.find({ collection: 'unknown' })).docs.length, 0, 'an unnamed collection is empty, not an error')
  assert.equal((await p.findVersions()).docs.length, 0)
  await p.create({ collection: 'pages', data: { title: 'x' } })
  assert.equal(calls.length, 1, 'writes are recorded')
})

// ONE SCHOOL BY DEFAULT. A fake that answered the row count for every
// collection made tenant resolution see five hundred schools and refuse to read
// users unscoped — the guard was right and the harness was wrong.
test('tenants answer one unless the test says otherwise', async () => {
  const { payload } = fakePayload({ counts: { users: 500 }, docs: { users: [{ id: 1 }] } })
  const p = payload as unknown as { count: (a: { collection: string }) => Promise<{ totalDocs: number }> }

  assert.equal((await p.count({ collection: 'tenants' })).totalDocs, 1)
  assert.equal((await p.count({ collection: 'users' })).totalDocs, 500, 'and a stated count is honoured')
})

test('the request carries a host, because every tool resolves a tenant from it', () => {
  const { payload } = fakePayload()
  const req = fakeRequest(payload) as unknown as { headers: Headers }
  assert.equal(req.headers.get('host'), 'school.bg')
})

// ── standardising, not just deduplicating ──────────────────────────────────
//
// Sixteen test files stood up their own Payload fake and six repeated the same
// tenant stanza verbatim, because every tool resolves a tenant before it reads
// anything. Six copies of one fact is six places to update when tenancy
// changes, and five of them get missed. The list below may only SHRINK.
test('no NEW test file stands up its own Payload fake', () => {
  const baseline: string[] = (JSON.parse(readFileSync(join(SRC, '..', 'lean-fakes-baseline.json'), 'utf8')) as { files: string[] }).files
  const known = new Set(baseline)

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, out)
      else if (path.endsWith('.test.ts')) out.push(path)
    }
    return out
  }

  const own: string[] = []
  for (const path of walk(SRC)) {
    const rel = 'src' + path.slice(SRC.length)
    if (known.has(rel)) continue
    if (/const payload = \{/.test(readFileSync(path, 'utf8'))) own.push(rel)
  }

  assert.deepEqual(
    own,
    [],
    'use fakePayload from payload/testing.ts — or add the file to lean-fakes-baseline.json with a reason, which is a debt taken deliberately',
  )
})

test('the baseline only shrinks — every file in it still exists and still builds one', () => {
  // A stale entry lets a file drop out of the count without anybody deciding to
  // let it, which is how a ratchet quietly loosens.
  const baseline: string[] = (JSON.parse(readFileSync(join(SRC, '..', 'lean-fakes-baseline.json'), 'utf8')) as { files: string[] }).files
  const stale = baseline.filter((rel) => {
    try { return !/const payload = \{/.test(readFileSync(join(SRC, '..', rel), 'utf8')) }
    catch { return true }
  })
  assert.deepEqual(stale, [], 'these no longer build their own fake — remove them from the baseline, which may only shrink')
})
