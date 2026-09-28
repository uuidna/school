/**
 * The numbers the README states about this code, derived once.
 *
 * There were two copies of this: the sync script had a full list of number
 * words, the guard that checks the README had a shorter one. They agreed until
 * the tool count reached nineteen, which the guard's list did not contain — so
 * the guard failed while the README was correct, and the failure pointed at the
 * README rather than at itself.
 *
 * Two tables answering one question is how that happens. There is one now, and
 * both the fix and the check read it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one',
  'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six',
  'twenty-seven', 'twenty-eight', 'twenty-nine', 'thirty', 'thirty-one',
  'thirty-two', 'thirty-three', 'thirty-four', 'thirty-five',
]

/** The word for a count, or the digits when it runs past the list. */
export const asWord = (n) => {
  const word = WORDS[n]
  return word ? word[0].toUpperCase() + word.slice(1) : String(n)
}

/** A stated count back to a number, whether it was written as a word or digits. */
export const fromWord = (raw) => {
  const index = WORDS.indexOf(String(raw).toLowerCase())
  return index === -1 ? Number(raw) : index
}

const walk = (dir, match, acc = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, match, acc)
    else if (match(entry)) acc.push(full)
  }
  return acc
}

/** Counted from the source so this runs without a build. */
export const facts = (root) => {
  const src = join(root, 'src')
  const sources = walk(src, (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  return {
    roles:
      (readFileSync(join(src, 'access/roles.ts'), 'utf8')
        .match(/export type SchoolRole = ([^\n]+)/)?.[1]
        ?.split('|').length) ?? 0,
    tests: walk(src, (f) => f.endsWith('.test.ts')).reduce(
      (total, file) => total + (readFileSync(file, 'utf8').match(/^test\(/gm) ?? []).length,
      0,
    ),
    // A tool is an entry with a name, roles and a writes flag. Counted from
    // source so this runs without a build; the guard counts the same thing
    // from the built barrel, and the two are checked against each other.
    tools: sources.reduce(
      (total, file) => total + (readFileSync(file, 'utf8').match(/^ {4}name: 'school_/gm) ?? []).length,
      0,
    ),
    // The tools of one section, because the README describes them one section
    // at a time and "Three tools" went on saying three while two more were
    // added beside them.
    financingTools: (readFileSync(join(src, 'mcp/financing.ts'), 'utf8').match(
      /^ {4}name: 'school_/gm,
    ) ?? []).length,
    cssTests: (readFileSync(join(src, 'ui/css-security.test.ts'), 'utf8').match(/^test\(/gm) ?? [])
      .length,
    /**
     * Tests that read the source tree rather than the code's own output.
     *
     * Counted per test rather than per file: a file may hold one such guard
     * among twenty ordinary tests. The README said seven; there were
     * twenty-six, because every one of these was added by hand to a sentence
     * nobody recomputed.
     */
    scanningTests: walk(src, (f) => f.endsWith('.test.ts')).reduce((total, file) => {
      const blocks = readFileSync(file, 'utf8').split(/(?=^test\()/m).slice(1)
      return total + blocks.filter((block) => /\bFILES\b|\bsources\(|readFileSync|\bSRC\b|compiled\(/.test(block)).length
    }, 0),
  }
}

/** The README with its stated numbers brought in line. */
export const applyFacts = (readme, { cssTests, financingTools, roles, scanningTests, tests, tools }) =>
  readme
    .replace(/\d+ tests, no test dependencies/, `${tests} tests, no test dependencies`)
    // [\w-]+ rather than \w+: number words are hyphenated past twenty, and \w
    // excludes the hyphen — so "Twenty-two tools" was matched as "two tools"
    // and rewritten in place, leaving a count that read as 2.
    .replace(/[\w-]+ tools, each declaring/, `${asWord(tools)} tools, each declaring`)
    .replace(/[\w-]+ roles — /u, `${asWord(roles)} roles — `)
    .replace(/[\w-]+ tools\. `school_financing_opportunities`/, `${asWord(financingTools)} tools. \`school_financing_opportunities\``)
    .replace(/[\w-]+ tests keep it that way/, `${asWord(cssTests)} tests keep it that way`)
    .replace(/[\w-]+ of them read the \*\*source tree\*\*/, `${asWord(scanningTests)} of them read the **source tree**`)
