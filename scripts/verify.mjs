#!/usr/bin/env node
/**
 * Everything that must be true before this package is published.
 *
 * Each check below was run by hand, repeatedly, during the work that produced
 * this package — and the one that mattered most was found by accident. Every
 * published entry point once threw ERR_MODULE_NOT_FOUND on import while the
 * build was green, because `tsc` is happy with extensionless specifiers that
 * Node ESM refuses. A green build says the code compiles. It does not say the
 * artefact loads.
 *
 * So the artefact is loaded here, from the files that actually ship.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })

const failures = []
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL  ${name}`)
  }
}

/*
 * Two things the old `rm -rf dist` was doing at once: proving the code compiles
 * from nothing, and guaranteeing no stale output survives. It also emptied the
 * directory a sibling repo resolves this package from, so a build over there
 * during a verify here failed on a missing file.
 *
 * They separate cleanly. A type-check with no emit proves compilation without
 * touching what is built, and pruning removes exactly what is stale. At no
 * point is a file that should exist missing.
 */
console.log('\ntype-checking from nothing')
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])

console.log('\nbuilding')
run('npm', ['run', 'build', '-s'])
run('npm', ['run', 'prune', '-s'])

console.log('\nchecking the artefact')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// Every advertised entry point, imported the way a consumer would.
for (const [subpath, entry] of Object.entries(pkg.exports)) {
  const file = typeof entry === 'string' ? entry : entry.default
  if (!file?.endsWith('.js')) continue

  await check(`import "${pkg.name}${subpath.replace(/^\./, '')}"`, async () => {
    const loaded = await import(pathToFileURL(join(ROOT, file)).href)
    if (Object.keys(loaded).length === 0 && subpath !== './provision') {
      throw new Error('loaded but exports nothing')
    }
  })
}

// The CLI must be executable, not merely present.
await check('the provision command runs', async () => {
  const bin = Object.values(pkg.bin ?? {})[0]
  if (!bin) throw new Error('no bin declared')
  try {
    execFileSync('node', [join(ROOT, bin)], { cwd: ROOT, stdio: 'pipe' })
  } catch (error) {
    // Exits non-zero asking for its arguments: that is it working.
    const said = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (!said.includes('missing --')) throw new Error(`did not ask for arguments: ${said.slice(0, 120)}`)
  }
})

await check('no extensionless relative import reaches dist', async () => {
  const { execSync } = await import('node:child_process')
  const found = execSync(
    `grep -rhoE "from '\\.[^']*'" ${join(ROOT, 'dist')} --include='*.js' | grep -v "\\.js'" | sort -u || true`,
    { encoding: 'utf8' },
  ).trim()
  if (found) throw new Error(`Node ESM cannot resolve these:\n${found}`)
})

console.log('\nrunning the suite')
run('npm', ['test', '-s'])

console.log('\npacking')
run('npm', ['pack', '--dry-run'])

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('\nready to publish\n')
