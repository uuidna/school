#!/usr/bin/env node
/**
 * What this package still defines that something else already defines, and
 * which of it can move.
 *
 * THE RULE, FOUND BY DOING IT WRONG FIRST. A bespoke collection earns its
 * place only when something about it rests on a constraint the STORE must
 * enforce. `random-selections` needs a unique index on (tenant, seq): without
 * one, two draws that race read the same head and both insert, forking the
 * chain silently, and every verification afterwards passes on a forked trail.
 * That cannot live in `form-submissions`, where the fields are values inside an
 * array — a child table of {parent, order, field, value} — with no column for a
 * constraint to sit on.
 *
 * Everything else is records. `access-log` was eight fields of which six
 * restated a document Payload already versions; it moved in wave 1 and this
 * script now reports it gone rather than remembering that it went.
 *
 * SO THE NEXT WAVE IS COMPUTED, NOT CHOSEN. The constraint-bearing set is read
 * out of assertSchema — the same door that refuses a deployment lacking the
 * index — and the movable set is what is left. Deciding it by hand each time
 * was the manual step; this is the cure.
 *
 *   node scripts/waves.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Every collection this package defines, read from the plugins that define them. */
const defined = () => {
  const found = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) { walk(rel); continue }
      if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue
      const text = read(rel)
      for (const m of text.matchAll(/slug: '([a-z][a-z-]+)'/g)) {
        if (!found.has(m[1])) found.set(m[1], rel)
      }
    }
  }
  walk('src/plugins')
  return found
}

/**
 * Collections something in the store must enforce a rule about.
 *
 * TWO KINDS OF CONSTRAINT, and the first version of this counted only one.
 * A unique index is read out of assertSchema — `random-selections` needs one
 * on (tenant, seq) or two racing draws fork the chain silently. That was the
 * whole rule, and it proposed moving `receipt-roots` into `form-submissions`,
 * which the mutation run caught on its way out: form-submissions is
 * `create: () => true`, UNAUTHENTICATED, because the public submits forms —
 * correct for a form builder and catastrophic for a chain checkpoint, where
 * `create: canDraw` is the only thing between a stranger and a forged seal.
 *
 * So an ACCESS RULE narrower than "any signed-in user" is a store-enforced
 * constraint too, and a collection carrying one is not a plain record. Both
 * are read from the source rather than listed, so a collection that gains
 * either tomorrow stops being movable without anybody editing this file.
 */
const constrained = () => {
  const guard = read('src/payload/schema.ts')
  const locked = new Map(
    [...guard.matchAll(/hasUniqueIndexOn\(payload, '([a-z-]+)'/g)].map((m) => [m[1], 'assertSchema demands a unique index on it']),
  )

  // A collection whose own definition restricts create, update or delete is
  // enforcing something the store has to enforce. `() => false` counts: that is
  // append-only, which is a rule about who may write and not a field.
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) { walk(rel); continue }
      if (!rel.endsWith('.ts') || rel.endsWith('.test.ts')) continue
      const text = read(rel)
      for (const m of text.matchAll(/slug: '([a-z][a-z-]+)'/g)) {
        const from = m.index
        const next = text.indexOf("slug: '", from + 10)
        const body = text.slice(from, next === -1 ? text.length : next)
        const narrow = [...body.matchAll(/\b(create|update|delete):\s*(?!\(\)\s*=>\s*true)([^,\n]*)/g)]
        if (narrow.length) locked.set(m[1], `${narrow.map((n) => n[1]).join('/')} is narrower than public — form-submissions is create: () => true`)
      }
    }
  }
  walk('src/plugins')
  return locked
}

/** Where a plain record can go instead, and what it costs to put it there. */
const HOMES = {
  'form-submissions': {
    cost: 'submissionData is an array of {field, value}: every value is a string, so numbers and dates are parsed at read time, and a query is a join rather than a column read',
    what: 'forms + form-submissions (@payloadcms/plugin-form-builder)',
  },
  versions: {
    cost: 'the actor and the reason must travel on the document, because a version records what it BECAME and not who changed it or why',
    what: "Payload's built-in version history",
  },
}

const slugs = defined()
const locked = constrained()

console.log('\nCOLLECTIONS THIS PACKAGE DEFINES\n')

const movable = []
for (const [slug, where] of [...slugs].sort()) {
  if (locked.has(slug)) {
    console.log(`  STAYS    ${slug.padEnd(22)} ${locked.get(slug)}`)
  } else {
    movable.push(slug)
    console.log(`  MOVABLE  ${slug.padEnd(22)} plain records — ${where}`)
  }
}

console.log(`\n${movable.length} movable, ${slugs.size - movable.length} constraint-bearing.`)

if (movable.length === 0) {
  console.log('\nNo wave to run: every remaining collection earns its place.\n')
  process.exit(0)
}

console.log('\nNEXT WAVE\n')
console.log(`  move: ${movable.join(', ')}`)
console.log(`  into: ${HOMES['form-submissions'].what}`)
console.log(`  cost: ${HOMES['form-submissions'].cost}`)
console.log('\n  Each is done when: the reader returns the same shape from the new home,')
console.log('  a test proves the derivation, and the collection is gone from the plugin.\n')

// A wave left to run is not a failure — it is a plan. Exit 0 and say so.
process.exit(0)
