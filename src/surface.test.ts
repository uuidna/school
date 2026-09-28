import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

// THE BARRELS ARE THE PACKAGE, as far as anybody installing it is concerned.
// An export dropped from index.ts is a working module that nobody can reach,
// and the build stays green because the module still compiles.

const ROOT = resolve(process.cwd())
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8')

const modules = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(ROOT, rel)).isDirectory()) modules(rel, acc)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) acc.push(rel)
  }
  return acc
}

test('every module with runtime exports is reachable from the package root', () => {
  const index = read('src/index.ts')

  // Barrels and the CLI are not re-exported: one is the root itself, the
  // others are named entry points, and provision.ts is a command.
  const notReExported = new Set([
    'src/index.ts',
    'src/provision.ts',
    'src/fair/index.ts',
    'src/mcp/index.ts',
    'src/packs/index.ts',
    'src/plugins/index.ts',
    'src/deploy/index.ts',
  ])

  const subpaths = (JSON.parse(read('package.json')) as { exports: Record<string, unknown> }).exports
  const unreachable: string[] = []

  for (const path of modules('src')) {
    if (notReExported.has(path)) continue

    const text = read(path)
    // Type-only modules contribute nothing at runtime.
    if (!/export (?:const|function|async function|class) /.test(text)) continue

    const specifier = path.replace(/^src\//, './').replace(/\.ts$/, '.js')
    const viaSelf = index.includes(`'${specifier}'`)
    /*
     * A module may also ship under its own subpath in package.json exports,
     * which is how the README imports the MCP tools — and how the deploy keeps
     * node:child_process out of a Worker bundle, since anything re-exported
     * from the root is imported by every consumer of the root.
     *
     * Any directory with a barrel is a candidate; the two conditions below
     * decide whether it is actually reachable — re-exported from the root, or
     * advertised as a subpath. Listing the directories by hand needed editing
     * whenever one was added, and the failure mode of forgetting is this test
     * calling a working module unreachable, which is what it did for
     * src/deploy. Deriving them from the exports alone was worse: it dropped
     * plugins, which is reached through the root barrel rather than a subpath.
     */
    const viaBarrel = readdirSync(join(ROOT, 'src'))
      .filter((entry) => statSync(join(ROOT, 'src', entry)).isDirectory())
      .filter((entry) => existsSync(join(ROOT, 'src', entry, 'index.ts')))
      .some((dir) => {
      if (!path.startsWith(`src/${dir}/`)) return false
      const barrel = read(`src/${dir}/index.ts`)
      const local = path.replace(`src/${dir}/`, './').replace(/\.ts$/, '.js')
      if (!barrel.includes(`'${local}'`)) return false
      return index.includes(`'./${dir}/index.js'`) || `./${dir}` in subpaths
    })

    if (!viaSelf && !viaBarrel) unreachable.push(path)
  }

  assert.deepEqual(unreachable, [], 'these modules cannot be imported from @uuidna/school')
})

test('every entry point the package advertises resolves to a file it ships', () => {
  const pkg = JSON.parse(read('package.json')) as {
    bin?: Record<string, string>
    exports: Record<string, { default?: string; types?: string } | string>
    files: string[]
    main: string
    types: string
  }

  const shipped = new Set(pkg.files)
  const paths = [
    pkg.main,
    pkg.types,
    ...Object.values(pkg.exports).flatMap((entry) =>
      typeof entry === 'string' ? [entry] : [entry.default, entry.types],
    ),
    ...Object.values(pkg.bin ?? {}),
  ].filter((p): p is string => Boolean(p))

  for (const path of paths) {
    const root = path.replace(/^\.\//, '').split('/')[0]!
    assert.ok(shipped.has(root), `${path} is advertised but "${root}" is not in files`)

    // .d.ts and .js are emitted from the same source module.
    const source = `src/${path.replace(/^\.\/dist\//, '').replace(/\.d\.ts$|\.js$/, '.ts')}`
    assert.doesNotThrow(
      () => statSync(join(ROOT, source)),
      `${path} is advertised but ${source} does not exist`,
    )
  }
})

test('every command the docs tell someone to run actually exists', () => {
  // `npm run school:provision` was documented for the life of the package and
  // was never a script. A documented command that does not exist fails on a
  // stranger's first try, which is the only try that matters.
  const pkg = JSON.parse(read('package.json')) as {
    bin?: Record<string, string>
    scripts: Record<string, string>
  }

  const docs = [read('README.md'), ...modules('src').map(read)].join('\n')

  for (const match of docs.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
    assert.ok(match[1]! in pkg.scripts, `"npm run ${match[1]}" is documented but is not a script`)
  }

  for (const match of docs.matchAll(/npx ([a-z][a-z0-9-]*)/g)) {
    const name = match[1]!
    if (name === 'tsc') continue
    assert.ok(name in (pkg.bin ?? {}), `"npx ${name}" is documented but is not a bin`)
  }
})

test('the CLI can be executed as the docs say', () => {
  const provision = read('src/provision.ts')
  assert.match(provision, /^#!\/usr\/bin\/env node/, 'the command has no shebang')
})
