#!/usr/bin/env node
// stamp-identity — WRITE WHAT THIS BUILD IS, into the build, so a consumer never has to guess.
//
// @uuidna/school reaches live deployments as a `file:` dependency: no registry version, no integrity hash, and
// `npm install --install-links` copies whatever is in the working tree at that moment. A consuming school that
// wants to know WHICH school it installed has, today, only one option — hash the dist itself — and that is a
// consumer guessing at a producer's build. Worse, it is N consumers each guessing slightly differently about
// one package, when the package is the only party that knows what its own build produced.
//
// So the package states its own identity. One answer, ours, checkable by anyone in one line.
//
// THE DIST ADDRESS IS THE VERSION THAT MOVES. `version` in package.json is for people and moves when somebody
// decides it does; the dist address moves when a single byte of shipped code moves, which is the question a
// consumer is actually asking. Both travel together: the semver says what we meant, the address says what we
// shipped.
//
// ORDER-INDEPENDENT BY CONSTRUCTION: files are sorted by path before folding, so the same dist hashes the same
// on any filesystem that hands them back in a different order. The stamp EXCLUDES itself, because a file that
// contains its own hash cannot.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIST = join(ROOT, 'dist')
const STAMP = join(DIST, 'identity.json')

const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

const files = walk(DIST).filter((p) => p !== STAMP).sort()
if (files.length === 0) {
  console.error('stamp-identity: REFUSED — dist is empty. Stamping an empty build would publish an identity for nothing.')
  process.exit(1)
}

// each file's own digest, then one fold over "path:digest" lines — a changed byte anywhere moves the address,
// and a renamed file moves it too, because the path is inside the fold.
const lines = files.map((p) => `${relative(DIST, p)}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`)
const address = createHash('sha256').update(lines.join('\n')).digest('hex')

// the git rev is a CONVENIENCE, never the identity: a dirty tree has a clean rev, so the address is what binds.
let rev = null
let dirty = null
try {
  rev = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0
} catch { /* not a git checkout: the address still identifies the build, which is the part that matters */ }

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const identity = {
  name: pkg.name,
  version: pkg.version,
  /** sha256 over every shipped file's digest, paths included, sorted — THE identity */
  dist: address,
  files: files.length,
  rev,
  /** true when the tree had uncommitted changes at build time: the rev does NOT describe this dist */
  dirty,
  stampedBy: 'scripts/stamp-identity.mjs',
}
writeFileSync(STAMP, JSON.stringify(identity, null, 2) + '\n')
console.log(`✓ stamp-identity — ${pkg.name}@${pkg.version} dist ${address.slice(0, 16)}… over ${files.length} files${dirty ? ' (DIRTY tree — the rev does not describe this build)' : ''}`)
