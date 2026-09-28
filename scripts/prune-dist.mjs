#!/usr/bin/env node
/**
 * Removes built files whose source is gone, without emptying anything.
 *
 * `tsc` does not prune, so renaming a module leaves its old output behind and
 * `node --test dist/**` goes on running compiled tests for a file that no
 * longer exists. The first fix was to clean before every build, which worked
 * and broke somebody: a sibling repo resolves this package from the working
 * tree, so every test run here emptied `dist` for a few seconds and their
 * build failed on a missing file.
 *
 * Deleting only the orphans fixes the same bug without ever leaving `dist`
 * unusable. Build first, prune second: at no point is a file that should exist
 * missing.
 */
import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const SRC = join(ROOT, 'src')

if (!existsSync(DIST)) {
  console.log('nothing built yet')
  process.exit(0)
}

/** The source a built file came from, whichever of the four shapes it is. */
const sourceOf = (built) =>
  join(SRC, built.replace(/\.d\.ts\.map$|\.d\.ts$|\.js\.map$|\.js$/, '.ts'))

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else acc.push(relative(DIST, full))
  }
  return acc
}

const orphans = walk(DIST).filter((built) => !existsSync(sourceOf(built)))

for (const orphan of orphans) unlinkSync(join(DIST, orphan))

// Directories left holding nothing, innermost first.
const directories = []
const collect = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collect(full)
      directories.push(full)
    }
  }
}
collect(DIST)
for (const dir of directories) {
  if (readdirSync(dir).length === 0) rmdirSync(dir)
}

if (orphans.length === 0) {
  console.log('dist matches src')
} else {
  console.log(`pruned ${orphans.length} built file(s) whose source is gone:`)
  for (const orphan of orphans.slice(0, 10)) console.log(`  ${orphan}`)
  if (orphans.length > 10) console.log(`  … and ${orphans.length - 10} more`)
}
