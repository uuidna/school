/**
 * A COMMITTED RECEIPT OF WHAT THE SUITE ACTUALLY RAN — learned from @uuidna/qpu, which has carried one and a
 * `proof` script that refuses a drifted receipt since before this package had any equivalent.
 *
 * WHY THIS PACKAGE IN PARTICULAR NEEDS IT: scripts/mutate.mjs records that this suite once shipped green while
 * matching NOTHING — `node --test dist/` printing "tests 1" — and a green run of zero tests is indistinguishable
 * from a green run of six hundred unless the count is written down and compared. A receipt turns a silent
 * collapse into a diff.
 *
 * It records the COUNTS and not the names, deliberately. A receipt listing every test would diff on every added
 * test, so nobody would read it; one that records totals diffs only when the shape of the suite changes, which
 * is the event worth a human look.
 *
 * A node:test reporter, so it counts what the runner counted rather than parsing its printed output.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'test-receipt.json')

export default async function* receipt(source) {
  let pass = 0, fail = 0, skip = 0, todo = 0
  const files = new Set()

  for await (const event of source) {
    const file = event.data?.file
    if (file) files.add(file)
    if (event.type === 'test:pass') {
      if (event.data.skip) skip++
      else if (event.data.todo) todo++
      else pass++
    }
    if (event.type === 'test:fail') fail++
    yield ''   // the receipt is the output; the suite's own reporter prints elsewhere
  }

  const body = {
    kind: 'test-receipt',
    standard:
      'the counts this suite actually ran, committed. A green run of zero tests is indistinguishable from a '
      + 'green run of six hundred unless the number is written down — and this suite has shipped green while '
      + 'matching nothing. `npm run proof` refuses a receipt that moved without somebody meaning it to.',
    tests: pass + fail + skip + todo,
    pass,
    fail,
    skip,
    todo,
    files: files.size,
  }
  writeFileSync(OUT, JSON.stringify(body, null, 2) + '\n')
  yield `\ntest-receipt — ${body.tests} test(s) across ${body.files} file(s): ${pass} pass, ${fail} fail, ${skip} skip\n`
}
