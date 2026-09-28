#!/usr/bin/env node
/**
 * Every guard in this package, proved able to fail.
 *
 * A test that cannot fail is furniture, and this package has shipped two:
 * `node --test dist/` matching nothing and printing "tests 1", and a README
 * count repaired by `docs:sync` before the guard that checks it ever ran. Both
 * were green. Both were measuring the apparatus.
 *
 * So each guard here is paired with the exact edit that should break it. The
 * runner applies one, runs the suite, restores the file, and records whether
 * the suite noticed. A mutant that SURVIVES is the finding: it names a
 * property nothing is actually checking. The ratio killed/total is the
 * mutation score.
 *
 * This existed as a shell function retyped per mutation, which cost a
 * round-trip each and left no record. It is a table now, in the repository,
 * because a mutation run that lives in somebody's terminal is one
 * that runs once.
 *
 *   node scripts/mutate.mjs            every mutation
 *   node scripts/mutate.mjs roster     only those whose label matches
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/**
 * Each row: the file, the exact text to replace, what to replace it with, and
 * what breaking it should mean. `from` must occur exactly once — an anchor
 * that stops matching is how a mutation silently becomes a no-op and reports a
 * guard as passing when nothing was tested. That happened repeatedly before
 * this file existed, and it is checked below rather than hoped for.
 */
const MUTATIONS = [
  // ---- the draw, and who may be in it ----
  { label: 'roster: parents counted as pupils', file: 'src/sources/roster.ts',
    from: "if (entry.role === 'parent' || !entry.id) continue",
    to: "if (!entry.id) continue",
    breaks: 'a parent could be drawn for a pupil’s place' },
  { label: 'roster: handle stops being class-scoped', file: 'src/sources/roster.ts',
    from: 'canonical([DOMAIN, classId, memberId])',
    to: 'canonical([DOMAIN, memberId])',
    breaks: 'two rosters could be joined into a child’s timetable' },
  { label: 'roster: conflict settled by arrival order', file: 'src/sources/roster.ts',
    from: "const role = held && held.role !== entry.role ? 'teacher' : entry.role",
    to: 'const role = entry.role',
    breaks: 'a duplicate’s role would depend on how the pages fell' },
  { label: 'roster: the mirror always agrees', file: 'src/sources/roster.ts',
    from: 'return resealed.rosterHash === published',
    to: 'return true',
    breaks: 'any class list would open any commitment' },

  // ---- the draw itself ----
  { label: 'draw: receipt commits to a short roster', file: 'src/fair/draw.ts',
    from: 'rosterHash: await rosterHashOf(candidates),',
    to: 'rosterHash: await rosterHashOf(candidates.slice(0, -1)),',
    breaks: 'the tail of the roster would be unprovable' },

  // ---- provenance ----
  { label: 'provenance: altered records evaluated anyway', file: 'src/financing/assess.ts',
    from: "if (provenance.verified === false) throw new AlteredProgramme(programme.id, provenance.reason)",
    to: '',
    breaks: 'a record whose contents contradict its address would be assessed' },
  { label: 'provenance: silence read as no conditions', file: 'src/financing/assess.ts',
    from: 'if ((programme.criteria ?? []).length === 0 && !programme.conditionsUnparsed) {',
    to: 'if (false) {',
    breaks: 'a call nobody has read would report eligible' },
  { label: 'provenance: stage order treated as irrelevant', file: 'src/financing/provenance.ts',
    from: 'workflow: (programme.workflow ?? []).map(trimmed),',
    to: 'workflow: (programme.workflow ?? []).map(trimmed).sort(),',
    breaks: 'a two-stage call reversed would read as unchanged' },

  // ---- what reaches a model ----
  { label: 'untrusted: the length bound removed', file: 'src/sources/untrusted.ts',
    from: 'if (text.length <= max) return text',
    to: 'return text',
    breaks: 'a wall of injected text would reach the caller whole' },
  { label: 'untrusted: whitespace padding allowed', file: 'src/sources/untrusted.ts',
    from: "value.replace(/\\s+/gu, ' ').trim()",
    to: 'value.trim()',
    breaks: 'four hundred newlines could push an answer off the screen' },

  // ---- Payload’s own gates ----
  // THE GUARANTEE MOVED, SO THE MUTANT MOVED. This row used to flip the
  // access-log collection's `create: () => false` to true. There is no such
  // collection now: the trail is Payload's version history, which is immutable
  // by construction rather than by an access rule. What CAN still be broken is
  // retention — Payload keeps 100 versions per document by default, and a
  // truncating audit trail answers an inspection with a confident, incomplete
  // account.
  { label: 'payload: the access trail allowed to truncate', file: 'src/plugins/rbac/index.ts',
    from: "              versions: { maxPerDoc: 0 },",
    to: "              versions: { maxPerDoc: 100 },",
    breaks: 'the oldest access changes would be dropped as an account is edited, and the grant that matters is usually the oldest' },
  { label: 'payload: a pupil may write the school year', file: 'src/plugins/calendar/index.ts',
    from: '    create: isAdminOrRegistrar,',
    to: '    create: isAuthenticated,',
    breaks: 'a pupil could delete the school year' },
  // TWO collections in this file open with `create: canDraw`. The first
  // version of this row anchored on that alone, the run refused it as
  // ambiguous, and it was right to: a one-occurrence replace would have
  // mutated whichever came first and reported a pass earned by luck.
  { label: 'payload: a pupil may insert a draw receipt', file: 'src/plugins/fair/index.ts',
    from: '    create: canDraw,\n    // Nothing may delete a draw',
    to: '    create: isAuthenticated,\n    // Nothing may delete a draw',
    breaks: 'a forged receipt would join the trail' },
  // AND THE ROW ITSELF WAS THE FIRST SURVIVING MUTANT. Its original form replaced a
  // COMMENT, so the suite passed and the battery reported an unguarded
  // property — correctly, since a mutation that cannot change behaviour
  // cannot test for it. The rule is what must move.
  { label: 'payload: a pupil may seal a root', file: 'src/plugins/fair/index.ts',
    from: '    create: canDraw,\n    // The root a parent checks',
    to: '    create: isAuthenticated,\n    // The root a parent checks',
    breaks: 'any signed-in account could publish a root the audit measures against' },

  // ---- who may see a pupil's record ----
  { label: 'rbac: a role change without a reason', file: 'src/mcp/rbac.ts',
    from: "      if (String(args.reason ?? '').trim().length < 8) {\n        return failure('A reason of at least 8 characters is required and is recorded in the audit log')\n      }\n\n      const user = await findUserByEmail(req, String(args.email))\n      if (!user) return text(`No account for ${args.email} — accounts are created in the admin panel`)",
    to: "      const user = await findUserByEmail(req, String(args.email))\n      if (!user) return text(`No account for ${args.email} — accounts are created in the admin panel`)",
    breaks: 'a right could be granted with no record of why' },
  { label: 'rbac: a parent may be revoked', file: 'src/mcp/rbac.ts',
    from: '      if (!STAFF_ROLES.includes(before as never)) {',
    to: '      if (false) {',
    breaks: 'a parent would be reclassified as a pupil and lose their class link' },
  { label: 'rbac: the local adapter drops the class', file: 'src/sources/payload.ts',
    from: "  ...(typeof doc.class === 'string' && doc.class.trim() ? { class: doc.class.trim() } : {}),",
    to: '',
    breaks: 'an access review could not say which class bounds a parent' },

  // ---- D1 ----
  { label: 'd1: the double binding forgotten', file: 'src/payload/schema.ts',
    from: 'const BOUND_PER_COLUMN = 2',
    to: 'const BOUND_PER_COLUMN = 1',
    breaks: 'a collection too wide to update would pass the boot check' },
  { label: 'd1: the ceiling applied to every sqlite host', file: 'src/payload/schema.ts',
    from: "/d1/i.test((payload.db as { name?: string } | undefined)?.name ?? '')",
    to: "/sqlite/i.test((payload.db as { name?: string } | undefined)?.name ?? '')",
    breaks: 'hosts with a 32,766 parameter ceiling would be failed' },

  // ---- the labs ----
  { label: 'labs: a term span read as one interval', file: 'src/labs/index.ts',
    from: 'const held = terms.find((term) => window.opens >= term.starts! && window.closes <= term.ends!)',
    to: 'const held = terms[0]',
    breaks: 'a study in July would sit inside the school year' },
  { label: 'labs: money may arrive after the pupils', file: 'src/labs/index.ts',
    from: "} else if (programme.window?.closes && programme.window.closes > lab.window.opens) {",
    to: '} else if (false) {',
    breaks: 'a call closing mid-study would count as funding it' },
  { label: 'labs: a cited basis taken on its look', file: 'src/labs/index.ts',
    from: '  } else if (held.law && !cited) {',
    to: '  } else if (false) {',
    breaks: 'an invented provision would pass as permission' },
  { label: 'labs: ready by omission', file: 'src/labs/index.ts',
    from: '    ready: grounds.every((g) => g.present),',
    to: '    ready: grounds.some((g) => g.present),',
    breaks: 'one ground would be enough to send a class somewhere' },

  // ---- the runtime, not the schema ----
  { label: 'runtime: the ceiling assumed rather than measured', file: 'src/payload/runtime.ts',
    from: '  const satisfied = ceiling >= PBKDF2_CURRENT',
    to: '  const satisfied = true',
    breaks: 'a Worker that cannot hash a password would boot reporting that it can' },
  { label: 'runtime: the probe walks past a refusal', file: 'src/payload/runtime.ts',
    from: '    } catch {\n      break\n    }',
    to: '    } catch {\n      continue\n    }',
    breaks: 'a capped runtime would report the highest count it never actually derived' },

  // ---- what of nature a lab reaches ----
  { label: 'nature: an instrument believed on its name', file: 'src/labs/nature.ts',
    from: '      if (BASE_NAMES.has(stated)) seen.add(stated)\n      else unrecognised.push({ instrument: instrument.name, stated })',
    to: '      seen.add(stated)',
    breaks: 'a "speed" reading would count as a base quantity and the school would read as reaching more of nature than it does' },
  { label: 'nature: a silent lab read as reaching nothing', file: 'src/labs/nature.ts',
    from: "    if (instruments.length === 0) {\n      silent.push(lab.place.name)\n      continue\n    }",
    to: '    if (instruments.length === 0) continue',
    breaks: 'a place that never said what it reads would be indistinguishable from one that reads nothing' },
  { label: 'labs: a ground states the fault and not the remedy', file: 'src/labs/index.ts',
    from: "      reason: 'no instrument recorded \u2014 state what each instrument measures, in SI base quantities, or fold the pupils\\' own observations with spacetimeOf so that unaided accounts are still placed, timed and comparable',",
    to: "      reason: 'no instrument recorded',",
    breaks: 'a finding would tell a school it is not equipped and never what to do about it' },

  // ---- talking to somebody else's server ----
  { label: 'transport: a refusal retried like a throttle', file: 'src/sources/transport.ts',
    from: "      if (!RETRYABLE_STATUS.includes(response.status) || attempt === attempts) return response",
    to: "      if (response.ok || attempt === attempts) return response",
    breaks: 'a 401 would be retried until the attempts ran out — hammering a server that already said no, and on some providers locking the account' },
  { label: 'transport: the deadline removed', file: 'src/sources/transport.ts',
    from: "    const timer = setTimeout(() => controller.abort(), timeoutMs)",
    to: "    const timer = setTimeout(() => undefined, timeoutMs)",
    breaks: 'a request that never answers would hold the worker open until the platform killed it' },

  // ---- the credential ----
  { label: 'token: a wrong credential retried forever', file: 'src/sources/token.ts',
    from: "  const first = await send(await token.get())\n  if (first.status !== 401) return first",
    to: "  let first = await send(await token.get())\n  while (first.status === 401) { token.invalidate(); first = await send(await token.get()) }\n  if (first.status !== 401) return first",
    breaks: 'a credential that is wrong rather than stale would be re-presented without end, which is how an account gets locked' },
  { label: 'token: held past its own expiry', file: 'src/sources/token.ts',
    from: "      if (held && held.expiresAt - skew > now()) return held.token",
    to: "      if (held) return held.token",
    breaks: 'a lapsed token would be presented until something 401s, turning a renewal into a failed audit' },

  { label: 'labs: a window read backwards', file: 'src/labs/index.ts',
    from: "  if (window.closes < window.opens) {",
    to: "  if (false) {",
    breaks: 'a study ending before it starts would pass the year check, and the funding test would compare a call\u2019s deadline against the wrong end of it' },

  { label: 'labs: a call whose window runs backwards', file: 'src/labs/index.ts',
    from: "    programme.window.closes < programme.window.opens",
    to: "    false",
    breaks: 'a call that cannot say when it closes would read as one that funds the study' },

  // ---- hosting an idea in the official collections ----
  { label: 'host: an empty batch read as a complete one', file: 'src/payload/host.ts',
    from: "    complete: refused.length === 0 && changed > 0,",
    to: "    complete: refused.length === 0,",
    breaks: 'a where-clause that matched nothing would report success — the likeliest outcome of a typo in the filter' },
  { label: 'host: a reference with no target accepted', file: 'src/payload/host.ts',
    from: "  if ((field.kind === 'relationship' || field.kind === 'upload') && field.to === undefined) {",
    to: "  if (false) {",
    breaks: 'a relationship naming no collection would ship as a field Payload cannot resolve' },

  // ---- the chain ----
  // THE SHORTCUT MUST STAY OPT-IN. Removing this line makes every audit take
  // the checkpoint's word by default, which is 415x faster and a different
  // claim: the stored hashes before the seal are never recomputed, so an edit
  // there becomes invisible. A probe found exactly that while it was built.
  { label: 'chain: the checkpoint shortcut taken by default', file: 'src/fair/chain.ts',
    from: "  const wanted = options?.trustCheckpoint === true && checkpoint?.head !== undefined && checkpoint.chainLength > 0",
    to: "  const wanted = true && checkpoint?.head !== undefined && checkpoint.chainLength > 0",
    breaks: 'a tampered prefix would pass as intact, because nothing recomputes the range the seal covers' },

  { label: 'chain: the sequence check removed', file: 'src/fair/chain.ts',
    from: '    if (link.seq !== expectedSeq) {',
    to: '    if (false) {',
    breaks: 'a missing or reordered receipt would verify' },
  { label: 'chain: a trail may start anywhere', file: 'src/fair/chain.ts',
    from: "  let expectedSeq = skip ? checkpoint!.chainLength : 0",
    to: "  let expectedSeq = skip ? checkpoint!.chainLength : (links[0]?.seq ?? 1) - 1",
    breaks: 'an imported trail would verify against its own numbering' },

  // ---- what a school looks like to a machine ----
  // THE ESCAPE IS THE WHOLE GUARD. A page title is editor-supplied text, and
  // inside a script element the HTML parser is still hunting for `</script`.
  // Without this replace, a title containing one closes the element and the
  // rest of the document becomes markup — script injection through „Заглавие".
  { label: 'schema: the script element can be closed from a title', file: 'src/seo/schema.ts',
    from: "    .replace(/</g, '\\\\u003c')",
    to: "    .replace(/</g, '<')",
    breaks: 'a page title could end the JSON-LD block and inject markup' },

  // ABSENCE MUST STAY ABSENCE. `stated` is what keeps a school with no
  // recorded street from publishing an empty one, which every aggregator
  // downstream would then republish as fact.
  { label: 'schema: empty fields stated rather than dropped', file: 'src/seo/schema.ts',
    from: "        value !== '' &&",
    to: "        true &&",
    breaks: 'a school with no telephone would publish an empty telephone' },

  { label: 'schema: the current page links to itself in its own trail', file: 'src/seo/schema.ts',
    from: "        item: index === crumbs.length - 1 ? undefined : crumb.url,",
    to: "        item: crumb.url,",
    breaks: 'the last breadcrumb would link to the page it is on' },

  { label: 'schema: list positions counted from zero', file: 'src/seo/schema.ts',
    from: "        position: index + 1,\n        url: typeof item === 'string' ? item : undefined,",
    to: "        position: index,\n        url: typeof item === 'string' ? item : undefined,",
    breaks: 'an ItemList numbered from 0 is read as unordered' },

  // A DATE NOBODY RECORDED IS NOT TODAY. Defaulting to now makes every
  // document look freshly revised on every build.
  { label: 'schema: a missing modification date invented', file: 'src/seo/schema.ts',
    from: "    dateModified: facts.dateModified ?? facts.datePublished,",
    to: "    dateModified: facts.dateModified ?? new Date().toISOString(),",
    breaks: 'an undated post would claim it was modified at build time' },

]

const wanted = process.argv[2]
const rows = wanted ? MUTATIONS.filter((m) => m.label.includes(wanted)) : MUTATIONS

if (!rows.length) {
  console.error(`no mutation matches "${wanted}" — labels: ${MUTATIONS.map((m) => m.label).join(', ')}`)
  process.exit(1)
}

/**
 * The suite, once, quietly, and BOUNDED. Returns whether it passed.
 *
 * A MUTANT THAT HANGS IS A MUTANT THAT WAS KILLED, and without a bound it looks
 * like a run that never finishes. Two of them do exactly that: removing the
 * transport's deadline makes the "never answers" test wait forever, and turning
 * the token's single retry into a loop makes the "wrong credential" test spin.
 * Both are the breakage those tests exist to detect — arriving as
 * non-termination instead of as a failure.
 *
 * Worse, a run stopped from outside never reaches its restore, so the tree is
 * left MUTATED. That happened twice here, once on a file git could not restore
 * because it was not yet tracked. The timeout keeps the decision inside this
 * runner, which always puts the file back.
 *
 * Generous, because a slow suite is not a hanging one: the honest suite takes
 * seconds and this allows minutes.
 */
const SUITE_TIMEOUT_MS = 180_000

/**
 * THE ROLLCALL, NOT `npm test`, BECAUSE THE PROOF IS A COMMITTED FILE.
 *
 * `npm test` attaches the receipt reporter, which writes test-receipt.json on every invocation, and `npm run
 * proof` requires that file to be unchanged from the committed one AND green. This runner invokes the suite once
 * per mutant and ends with a build, which never re-runs the suite — so the LAST MUTANT'S receipt was what stayed
 * on disk. Measured: clean receipt before one mutant, `M test-receipt.json` after it. A mutation run therefore
 * broke the proof for whoever ran it next, and the runner could not be wired into CI beside the proof step at all.
 *
 * test:rollcall is the same suite over the same built output with the receipt reporter dropped. docs:sync stays:
 * a mutant changes behaviour, not the number of tests, so the README count it writes is identical and the step is
 * idempotent under mutation — removing it would leave a stale README and fail readme.test.ts for every mutant,
 * which would report a perfect score while testing nothing. The same fault this file exists to catch.
 */
const suitePasses = () => {
  try {
    execSync('npm run test:rollcall', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: SUITE_TIMEOUT_MS })
    return true
  } catch (error) {
    // ETIMEDOUT is the mutant hanging the suite, which is a kill — the original
    // terminates and the mutant does not.
    if (error?.code === 'ETIMEDOUT') console.log('     (the mutant hung the suite — killed by timeout)')
    return false
  }
}

/**
 * THE BASELINE MUST BE GREEN OR EVERY MUTANT IS A FALSE KILL.
 *
 * A mutant is "killed" when the suite fails with it applied. If the suite ALREADY fails — a broken build, a
 * peer's half-finished edit, a genuinely failing test — then it fails for every mutant too, and the runner
 * reports a perfect score while testing nothing. That is the apparatus failing toward green, which is the exact
 * fault mutation testing exists to catch, and this runner shipped without a guard against it in itself.
 *
 * Checked once, before anything is touched, and refused rather than reported.
 */
if (!suitePasses()) {
  console.error(
    '\nMUTATION TESTING REFUSED — the suite does not pass before any mutation is applied.\n'
    + 'Every mutant would be recorded as killed and the score would be meaningless. Fix the suite first.\n',
  )
  process.exit(1)
}

console.log(`\nMUTATION TESTING — ${rows.length} mutant(s), baseline green\n`)

const survived = []
const noop = []

for (const m of rows) {
  const path = join(ROOT, m.file)
  const original = readFileSync(path, 'utf8')

  // AN ANCHOR THAT STOPPED MATCHING IS THE FAILURE MODE THIS CHECKS FOR. A
  // mutation that changes nothing runs the suite against untouched source and
  // reports the guard as sound. Occurrences are counted, not assumed.
  const hits = original.split(m.from).length - 1
  if (hits !== 1) {
    noop.push({ ...m, hits })
    console.log(`  ?  ${m.label}\n     anchor occurs ${hits} time(s), expected exactly 1 — NOT APPLIED`)
    continue
  }

  writeFileSync(path, original.replace(m.from, m.to))
  const passed = suitePasses()
  writeFileSync(path, original)

  if (passed) {
    survived.push(m)
    console.log(`  ✗  ${m.label}\n     SURVIVED — the suite still passed, so nothing checks that ${m.breaks}`)
  } else {
    console.log(`  ✓  ${m.label}`)
  }
}

// Leave the tree as it was found, built.
execSync('npm run build', { cwd: ROOT, stdio: 'pipe' })

console.log(`\nmutation score: ${rows.length - survived.length - noop.length}/${rows.length} killed`)
if (noop.length) console.log(`${noop.length} not applied — the anchor moved`)
if (survived.length) {
  console.log('\nSURVIVING MUTANTS:')
  for (const m of survived) console.log(`  ${m.label} — ${m.breaks}`)
}

process.exit(survived.length || noop.length ? 1 : 0)
