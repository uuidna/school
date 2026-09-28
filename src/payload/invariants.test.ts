import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { test } from 'node:test'

import { TENANT_PATH } from './scope.js'

// THESE GUARDS READ THE SOURCE, NOT EACH OTHER. Every rule below was a comment
// asking a future editor to remember something, and each one was forgotten at
// least once: a hand-written tenant filter that hardcoded the field name
// TENANT_PATH is supposed to be the only statement of, and reads that went out
// with access control silently defaulted on. A protection you must remember to
// re-apply is not a protection. So the rules are computed from the tree, and
// adding a call that breaks one fails the build rather than an audit.

const SRC = resolve(process.cwd(), 'src')

const sources = (): { path: string; text: string }[] => {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        out.push({ path: relative(SRC, full), text: readFileSync(full, 'utf8') })
      }
    }
  }
  walk(SRC)
  return out
}

const FILES = sources()

/**
 * Modules allowed a second implementation, each because a test holds it to the
 * first. The set is small on purpose and every member is checked below.
 */
const PROVEN_COPY = new Set(['ui/verifier.ts'])

test('the source tree is actually being read', () => {
  // A guard that silently scans nothing passes forever.
  assert.ok(FILES.length > 20, `expected the package's modules, found ${FILES.length}`)
  assert.ok(FILES.some((f) => f.path.endsWith('findAll.ts')))
})

test('no module writes a tenant filter by hand', () => {
  // The crack this closes: `where: { tenant: { equals: id } }` written at a
  // call site hardcodes a field name that TENANT_PATH is the single statement
  // of, and silently protects nothing if that name is ever wrong.
  const offenders = FILES.filter(
    (file) => file.path !== 'payload/scope.ts' && /\btenant:\s*\{\s*equals/.test(file.text),
  )

  assert.deepEqual(
    offenders.map((f) => f.path),
    [],
    'tenant confinement is derived from TENANT_PATH; it is not written at call sites',
  )
})

test('only scope.ts decides which field holds the tenant', () => {
  const offenders = FILES.filter(
    (file) => file.path !== 'payload/scope.ts' && /TENANT_PATH\s*\[/.test(file.text),
  )

  assert.deepEqual(offenders.map((f) => f.path), [])
})

test('tenant confinement cannot be switched off', () => {
  // findAll once had an `unscoped` flag that skipped access control AND the
  // school filter together, so every caller needing the first lost the second.
  const findAll = FILES.find((f) => f.path === 'payload/findAll.ts')!

  assert.ok(!/\bunscoped\b/.test(findAll.text), 'the conflated flag is back')
  assert.match(findAll.text, /const scope = req \? await tenantWhere/)
})

test('every local-API call states overrideAccess explicitly', () => {
  // Payload defaults it to true. A call that does not say so reads with
  // collection access control disabled, which is how "authorisation is
  // doubled" was a single gate for the life of the package.
  const missing: string[] = []

  for (const file of FILES) {
    const lines = file.text.split('\n')
    for (const match of file.text.matchAll(/payload\.(find|update|create|count|updateGlobal)\(\{/g)) {
      const start = file.text.slice(0, match.index).split('\n').length - 1
      let depth = 0
      let end = start
      for (let i = start; i < Math.min(start + 40, lines.length); i++) {
        depth += (lines[i]!.match(/\{/g) ?? []).length - (lines[i]!.match(/\}/g) ?? []).length
        if (depth <= 0 && i > start) { end = i; break }
      }
      if (!lines.slice(start, end + 1).join('\n').includes('overrideAccess')) {
        missing.push(`${file.path}:${start + 1} ${match[1]}`)
      }
    }
  }

  assert.deepEqual(missing, [], 'these reads would run with access control disabled')
})

test('every collection this package reads declares where its tenant lives', () => {
  // The seal: a new collection cannot be read until TENANT_PATH says whether
  // it is confined to a school or deliberately global. Without this, adding a
  // read is adding an unscoped read and nothing says so.
  const referenced = new Set<string>()

  for (const file of FILES) {
    for (const match of file.text.matchAll(/collection:\s*'([a-z][a-z0-9-]*)'/g)) {
      referenced.add(match[1]!)
    }
  }

  const undeclared = [...referenced].filter((slug) => !(slug in TENANT_PATH)).sort()

  assert.deepEqual(
    undeclared,
    [],
    `add these to TENANT_PATH — 'tenant' if confined to one school, null if deliberately global`,
  )
})

test('every collection this package reads is either shipped or declared the host’s', () => {
  // payloadSource.listCalendar read school-calendar before any plugin shipped
  // it: a self-hosted school would have got a runtime error from a capability
  // the sovereignty test reported as available, because that test compares
  // what sources declare and not whether the declaration is backed.
  //
  // So every slug this package reads must be one it ships, or one it says
  // plainly belongs to the host.
  const hosts = new Set([
    'documents', // a school's own document typology
    'media', // its file library
    'pages',
    'posts',
    'tenants', // the school register itself
    'users',
  ])

  const read = new Set<string>()
  for (const file of FILES) {
    for (const match of file.text.matchAll(/collection:\s*'([a-z][a-z0-9-]*)'/g)) {
      read.add(match[1]!)
    }
  }

  const shipped = new Set<string>()
  for (const file of FILES) {
    for (const match of file.text.matchAll(/slug:\s*'([a-z][a-z0-9-]*)'/g)) {
      shipped.add(match[1]!)
    }
  }

  const orphaned = [...read].filter((slug) => !shipped.has(slug) && !hosts.has(slug)).sort()

  assert.deepEqual(
    orphaned,
    [],
    'these are read and nothing creates them — ship a plugin, or add them to the host list with a reason',
  )
})

test('the discovery endpoint never enumerates the surface unfiltered', () => {
  // This regressed silently once: an edit's anchor stopped matching after an
  // unrelated change, the replacement quietly did nothing, and the fix was
  // reported as made. The claim is now checked rather than remembered.
  const server = FILES.find((f) => f.path === 'mcp/server.ts')!

  assert.ok(
    !/tools:\s*TOOLS\.map/.test(server.text),
    'GET /mcp lists every tool, including writes, to an unauthenticated caller',
  )
  assert.match(server.text, /auth\.authenticated\s*\?/)
})

test('the hashing primitives are defined once', () => {
  // toHex, sha256 and canonical had a copy each in draw.ts, chain.ts and
  // merkle.ts. They agreed, which is the only reason nothing had broken, and
  // nobody was checking that. A receipt's content address, the chain link that
  // commits to it and the Merkle leaf that seals it must be computed the same
  // way by three modules; one edit to one copy and a chain verifies against
  // receipts it no longer matches, with nothing reporting a fault.
  for (const primitive of ['toHex', 'fromHex', 'canonical', 'importHmacKey']) {
    const definers = FILES.filter((file) =>
      new RegExp(`(const|function) ${primitive}\\b`).test(file.text),
    )
      .map((file) => file.path)
      .filter((path) => !PROVEN_COPY.has(path))

    assert.deepEqual(definers, ['fair/hash.ts'], `${primitive} is defined more than once`)
  }
})

test('the one permitted copy is permitted only because a test compares it', () => {
  // ui/verifier.ts reimplements these because it runs in a parent's browser,
  // where there is no module to fetch from a Worker and no bundler to run. A
  // page that asked the server whether a draw was fair would not be checking
  // anything. The copy is allowed, and the exemption is conditional: delete the
  // equivalence test and this fails, so the duplication cannot outlive its
  // proof.
  const proof = readFileSync(join(SRC, 'ui/verifier.test.ts'), 'utf8')

  assert.match(proof, /from '\.\.\/fair\/draw\.js'/, 'the copy is not compared to the library')
  assert.match(proof, /from '\.\.\/fair\/merkle\.js'/)

  for (const compared of ['sha256', 'canonical', 'getUnbiasedInt', 'verifyInclusion']) {
    assert.match(proof, new RegExp(`page\\.${compared}\\(`), `${compared} is copied but never compared`)
  }
})

test('no module writes prose in one language outside a locale table', () => {
  // The package emitted Bulgarian from generic code — provisioning labelled
  // any school's document tree in a language its staff might not read, because
  // the school it was extracted from showed through. Localised text belongs in
  // a locale table or a jurisdiction pack, both of which are dedicated to it.
  // `i18n/` and `packs/` are exempt BY FOLDER rather than by filename. The list held 'i18n.ts' and
  // 'i18n/admin.ts' as two strings, so moving the first into the folder beside the second turned an exemption
  // into a failure with nothing wrong in the code — the guard was keyed to a path, not to the job the file does.
  // Every locale table this package adds is already covered.
  const localised = new Set(['provision.ts', 'slug.ts', 'ui/discover.ts', 'ui/page.ts'])
  const dedicated = (path: string) => path.startsWith('i18n/') || path.startsWith('packs/')

  const offenders = FILES.filter((file) => {
    if (localised.has(file.path) || dedicated(file.path)) return false
    // Strip comments: a docstring may quote a provision or an example.
    const code = file.text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    return /[\u0400-\u04FF\u4E00-\u9FFF]{4,}/.test(code)
  }).map((file) => file.path)

  assert.deepEqual(offenders, [], 'these emit one language from generic code')
})

test('nothing runs from a module that no longer exists', () => {
  // tsc does not prune. Renaming wheel.ts to draw.ts left dist/fair/wheel.js
  // and its compiled tests behind, and `node --test dist/**` went on running
  // them — ten tests for a file that was gone, passing, inflating the count
  // the README states. A test for deleted code is worse than no test: it
  // reports on something nobody can change.
  const dist = resolve(process.cwd(), 'dist')

  const compiled = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) compiled(full, acc)
      else if (entry.endsWith('.js')) acc.push(relative(dist, full))
    }
    return acc
  }

  const orphans = compiled(dist).filter(
    (file) => !existsSync(join(SRC, file.replace(/\.js$/, '.ts'))),
  )

  assert.deepEqual(orphans, [], 'these are built from source that is gone — run npm run clean')
})

test('no module retrieves an address a caller supplied', () => {
  // The allowlist that was going to fence this is gone, because the hole is
  // gone: a server that retrieves a caller's URL can be pointed at a metadata
  // endpoint or its own loopback, and the list holding that back is a table
  // somebody widens every time a school migrates from somewhere new. Only the
  // modules that talk to a named, fixed API may fetch at all.
  const mayFetch = new Set([
    'financing/eu.ts', // the EU portal, one hard-coded endpoint
    'provision.ts', // a CLI calling an endpoint the operator names
    'sources/google/api.ts', // Google's own hosts
    'sources/google/workspace.ts',
    // These two carry a browser-side fetch of their own data endpoint on this
    // origin, which the page's own CSP pins to connect-src 'self'. Nothing
    // server-side retrieves anything, and no address comes from a caller.
    'ui/discover.ts',
    'ui/page.ts',
  ])

  const offenders = FILES.filter(
    (file) => !mayFetch.has(file.path) && /\bfetch\(/.test(file.text),
  ).map((file) => file.path)

  assert.deepEqual(offenders, [], 'these retrieve something; check whose address it is')
})

test('no module hashes on its own', () => {
  // crypto.subtle belongs in one file, so what gets hashed is reviewable in
  // one place rather than in whichever module grew its own digest.
  const offenders = FILES.filter(
    // A call, not the words: draw.ts names crypto.subtle in its docstring.
    (file) =>
      file.path !== 'fair/hash.ts' &&
      !PROVEN_COPY.has(file.path) &&
      /crypto\.subtle\.\w+\(/.test(file.text),
  ).map((file) => file.path)

  assert.deepEqual(offenders, [])
})

test('TENANT_PATH declares nothing the package never reads', () => {
  // A stale entry is a rule nobody is following, which reads like a rule
  // somebody is.
  const referenced = new Set<string>()
  for (const file of FILES) {
    for (const match of file.text.matchAll(/collection:\s*'([a-z][a-z0-9-]*)'/g)) {
      referenced.add(match[1]!)
    }
  }
  // Plugins declare collections they ship without reading them here, and
  // `media` is read through a configurable slug rather than a literal.
  const shipped = new Set(['financing-programmes', 'media', 'pages', 'posts'])

  const unused = Object.keys(TENANT_PATH)
    .filter((slug) => !referenced.has(slug) && !shipped.has(slug))
    .sort()

  assert.deepEqual(unused, [])
})
