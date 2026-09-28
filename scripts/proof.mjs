#!/usr/bin/env node
/**
 * THE RECEIPT MUST BE GREEN, NOT MERELY UNCHANGED.
 *
 * `git diff --exit-code -- test-receipt.json` catches a receipt that MOVED. It says nothing about what the
 * receipt says. A receipt committed with a failure in it passes that check forever — the suite is red, the
 * receipt faithfully records that it is red, the diff is empty, and proof reports success. The drift guard and
 * the green guard are different questions and only one of them was being asked.
 *
 * Both are asked here: the receipt must be unchanged from the committed one AND must record a passing suite.
 *
 * WHAT THIS STILL CANNOT SEE, stated rather than left to be discovered: a receipt that was never REWRITTEN. If
 * the suite fails before the reporter runs — a type error, a build that does not emit — the previous receipt
 * stays on disk and every check here passes against it. Observed while adding a colliding export: `npm test`
 * exited 2 and proof reported 734 green tests that no run had produced. The composition is what closes it:
 * `npm test` exits non-zero in exactly that case, so proof is a check on a run that HAPPENED and not a
 * substitute for running. Freshness by file mtime was considered and refused — a checkout resets mtimes and the
 * guard would fail for a reason that has nothing to do with the suite.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const fail = (why) => { console.error(`✗ proof — ${why}`); process.exit(1) }

let receipt
try {
  receipt = JSON.parse(readFileSync('test-receipt.json', 'utf8'))
} catch (e) {
  fail(`test-receipt.json is unreadable (${String(e)}). A suite that wrote no receipt proved nothing.`)
}

// GREEN. The number the drift check never looks at.
if (receipt.fail !== 0) {
  fail(`the receipt records ${receipt.fail} failing test(s). An unchanged receipt of a red suite is still a red suite.`)
}
// AND NON-EMPTY, because a receipt of zero tests is the fault this package has actually shipped —
// `node --test dist/` matching nothing and printing "tests 1" while green.
if (!(receipt.tests > 0) || !(receipt.files > 0)) {
  fail(`the receipt records ${receipt.tests} test(s) across ${receipt.files} file(s). A green run of nothing is not a pass.`)
}

// UNCHANGED. The question the old proof asked, kept.
try {
  execFileSync('git', ['diff', '--exit-code', '--', 'test-receipt.json'], { stdio: 'pipe' })
} catch {
  fail('test-receipt.json moved. The suite changed shape — read the diff and commit it on purpose.')
}

console.log(`✓ proof — ${receipt.tests} test(s) across ${receipt.files} file(s), ${receipt.fail} failing, receipt unchanged`)
