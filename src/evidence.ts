/**
 * A TOOL THAT REPORTS SUCCESS AS AN ABSENCE MUST FIRST ASSERT THAT IT LOOKED.
 *
 * This is one fault with many disguises, and it was found six times in two repositories on one day — by two
 * people, neither of whom recognised it in the other's tree until it was named. The instances ARE the argument;
 * the rule on its own reads like advice.
 *
 *   A mutation runner scored 6/6 KILLED because the suite was already red: a mutant is "killed" when the suite
 *   fails with it applied, and a suite that already fails, fails for every mutant.
 *
 *   A proof harness scored a broken check PROVEN, because it asks whether a check fails against falsified
 *   inputs — and a check that fails against EVERYTHING satisfies that trivially. The ordinary run two lines
 *   above was printing FAIL for the same check.
 *
 *   `verify-secrets` announced "nothing secret is committed" in an EMPTY git repository. It never asserted it
 *   had read a file.
 *
 *   A repair registry announced "nothing left to repair" without asserting it had read a document, so a wrong
 *   database binding would have produced twelve CLEAN lines and a confident summary.
 *
 *   A trap suite asserts an empty list of offenders — which is exactly what a walk over the WRONG DIRECTORY
 *   produces. Pointed at a missing path, four of its five tests passed green.
 *
 *   `node --test dist/` matched nothing and printed "tests 1", green, in this very package.
 *
 * THE SHAPE, stated once: a boundary something downstream is entitled to erase, where erasing it produces an
 * ANSWER rather than an ERROR. Every one of these reports the strongest word its tool has. That is the only
 * direction that survives review, which is why they persist — a tool wrong in the other direction is fixed the
 * day it ships.
 *
 * (A seventh belongs here even though no guard could have caught it, because it is the same shape and the
 * mechanism is a surprise: SQLite is entitled to flatten a CTE into its consumer, and flattening a $unwind
 * stage into an aggregate lost the correlation so a grouping key read NULL — beside a correct sum, in the same
 * statement. Nothing was anyone's mistake; it was a contract nobody had written down.)
 *
 * THE RULE: assert the thing that would be MISSING, not the thing that would be wrong. A census of zero is not
 * a clean census. This module makes that a type rather than a discipline, because an unnamed pattern does not
 * generalise even inside one head — both of us already had this guard somewhere and still shipped the fault
 * somewhere else.
 */

export class LookedAtNothing extends Error {
  constructor(what: string) {
    super(
      `${what}: the census is EMPTY, so "nothing wrong" is not a finding — it is the absence of a search. `
      + 'A tool reporting success as an absence has to establish that it looked: point it at the right path, '
      + 'or report that it could not look, but do not report a clean result over nothing.',
    )
    this.name = 'LookedAtNothing'
  }
}

/** What a survey saw, and what it found wrong. `at` is the count it actually examined, not the count it hoped for. */
export interface Survey<T> {
  /** the subject, for the message — "secrets", "wings", "redirects" */
  of: string
  /** how many things were EXAMINED. Zero means the search did not happen, whatever the findings say. */
  at: number
  findings: readonly T[]
}

/**
 * clean(survey) → whether the survey found nothing wrong, having looked at something.
 *
 * THROWS on an empty census rather than returning true. Returning false would be wrong too — nothing is broken,
 * so a caller would go looking for a defect that does not exist — and returning true is the fault this module
 * is named after. The honest third answer is that the question was not asked.
 */
export function clean<T>(survey: Survey<T>): boolean {
  if (!Number.isInteger(survey.at) || survey.at < 0) {
    throw new LookedAtNothing(`${survey.of} reported a census of ${String(survey.at)}`)
  }
  if (survey.at === 0) throw new LookedAtNothing(survey.of)
  return survey.findings.length === 0
}

/**
 * report(survey) → the sentence, with the denominator in it.
 *
 * A clean result is only as strong as what it looked at, so the count travels WITH the verdict and a reader
 * never has to go and find it. "no secrets committed" and "no secrets committed across 412 files" are
 * different claims, and only one of them can be checked.
 */
export function report<T>(survey: Survey<T>): string {
  const ok = clean(survey)
  return ok
    ? `✓ ${survey.of} — clean across ${String(survey.at)}`
    : `✗ ${survey.of} — ${String(survey.findings.length)} finding(s) across ${String(survey.at)}`
}

/**
 * unasked(of, why) → the third answer, for when a tool genuinely could not look.
 *
 * An absent instrument VOIDS a result; it does not agree with it. A network that refused, a file that was not
 * there, a runtime without the API — each is a reason to report that the question was not asked, and none of
 * them is evidence that the answer is no.
 */
export const unasked = (of: string, why: string): string =>
  `· ${of} — UNASKED: ${why}. This is not a clean result; it is an unasked question.`
