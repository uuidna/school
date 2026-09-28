import type { JurisdictionPack } from '../packs/types.js'
import type {
  Applicant,
  Criterion,
  CriterionVerdict,
  Eligibility,
  FinancingProgramme,
  GuardianshipVerdict,
} from './types.js'

import { AlteredProgramme, UnprovenancedProgramme } from './types.js'
import { verifyProgramme } from './provenance.js'

/**
 * Deciding eligibility, and refusing to guess.
 *
 * Three outcomes, not two. A criterion is met, unmet, or **undecidable from
 * what the applicant has stated** — and an applicant who has not said how many
 * pupils they teach has not thereby failed a size condition, nor passed one.
 * Collapsing undecidable into either is how an engine produces a confident
 * answer that costs somebody a grant.
 *
 * `eligible` is therefore `undefined` whenever anything is undecidable, and the
 * report names what would settle it.
 */

const flatten = (applicant: Applicant): Record<string, unknown> => {
  const { attributes, ...rest } = applicant as Applicant & {
    attributes?: Record<string, unknown>
  }
  // Declared fields win: an `attributes` entry cannot overwrite `jurisdiction`
  // and quietly re-answer a criterion that was already decided.
  return { ...(attributes ?? {}), ...rest }
}

const describeValue = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : String(value)

const compare = (op: Criterion['op'], actual: unknown, expected: unknown): boolean | undefined => {
  switch (op) {
    case 'eq':
      return actual === expected
    case 'gte':
    case 'lte': {
      if (typeof actual !== 'number' || typeof expected !== 'number') return undefined
      return op === 'gte' ? actual >= expected : actual <= expected
    }
    case 'has': {
      if (!Array.isArray(actual)) return undefined
      return actual.includes(expected as never)
    }
    case 'in': {
      if (!Array.isArray(expected)) return undefined
      return expected.includes(actual as never)
    }
    case 'neq':
      return actual !== expected
    default:
      // An operator this build does not implement is undecidable, never false:
      // a newer programme must not read as a refusal on an older engine.
      return undefined
  }
}

export const evaluateCriterion = (
  criterion: Criterion,
  applicant: Applicant,
): CriterionVerdict => {
  const stated = flatten(applicant)[criterion.field]

  if (stated === undefined || stated === null) {
    return {
      criterion,
      reason: `"${criterion.describe}" — the applicant has not stated ${criterion.field}, so this cannot be decided here`,
      status: 'undecidable',
    }
  }

  const outcome = compare(criterion.op, stated, criterion.value)

  if (outcome === undefined) {
    return {
      criterion,
      reason: `"${criterion.describe}" — ${criterion.field} is ${describeValue(stated)}, which this engine cannot compare with ${criterion.op} ${describeValue(criterion.value)}`,
      status: 'undecidable',
    }
  }

  return {
    criterion,
    reason: `"${criterion.describe}" — ${criterion.field} is ${describeValue(stated)}, required ${criterion.op} ${describeValue(criterion.value)}`,
    status: outcome ? 'met' : 'unmet',
  }
}

/**
 * The age of majority to test against, and whether it was actually stated.
 *
 * Fails closed in both directions: an absent pack, or a pack that states no
 * majority, yields 18 — the strictest common threshold — rather than treating
 * the silence as permission. European and Bulgarian law are strict about
 * minors, so the failure mode this picks is "asked for a guardian who was not
 * needed", never "let a child commit themselves".
 */
const MAJORITY_FALLBACK = 18

/**
 * Whether a minor may apply in their own name.
 *
 * Not drawn from the programme. An authority that forgot to say so has not
 * thereby excused the school from asking, and a child applying alone with
 * nobody accountable is not a gap the engine should paper over. Equally, a
 * consent that was never sought is unknown rather than refused — supporting
 * researchers whatever their age means not slamming a door nobody knocked on.
 *
 * The threshold is the jurisdiction's, because it is not the same everywhere
 * and this engine has no business choosing it.
 */
export const assessGuardianship = (
  applicant: Applicant,
  jurisdiction?: JurisdictionPack,
): GuardianshipVerdict | undefined => {
  if (applicant.kind !== 'researcher') return undefined

  const majority = jurisdiction?.ages?.majority ?? MAJORITY_FALLBACK

  const minor =
    applicant.isMinor ?? (typeof applicant.age === 'number' ? applicant.age < majority : undefined)

  if (minor === false) {
    return { reason: 'the applicant is not a minor', required: false, satisfied: true }
  }

  if (minor === undefined) {
    return {
      reason: `the applicant has not stated whether they are a minor, and age was not collected — state isMinor to settle this without disclosing a birthday (majority here is ${majority}${jurisdiction?.ages?.majority === undefined ? ', assumed, because the jurisdiction pack states none' : ''})`,
      required: true,
      satisfied: undefined,
    }
  }

  if (applicant.guardianConsent === undefined) {
    return {
      reason: 'the applicant is a minor and guardian consent has not been established either way',
      required: true,
      satisfied: undefined,
    }
  }

  if (applicant.guardianConsent === null) {
    return {
      reason: 'the applicant is a minor and no guardian consent is recorded',
      required: true,
      satisfied: false,
    }
  }

  return {
    reason: `guardian consent recorded ${applicant.guardianConsent.at} via ${applicant.guardianConsent.evidencedBy}`,
    required: true,
    satisfied: true,
  }
}

/**
 * Assess one programme against one applicant.
 *
 * Refuses a programme with no provenance: this package does not evaluate
 * funding conditions that cannot say who published them and when they were
 * read. And refuses one whose contents no longer match the address they were
 * sealed with, which is the stronger failure — an unprovenanced record makes
 * no claim about where it came from, while an altered one makes a claim its
 * own contents contradict.
 *
 * Async because that check is a digest, and the alternative was a sync
 * evaluator with the verification bolted on at each call site. A protection
 * every caller has to remember to re-apply is not a protection; it is a crack
 * with a comment next to it, which this package has already had once.
 */
export const assess = async (
  programme: FinancingProgramme,
  applicant: Applicant,
  jurisdiction?: JurisdictionPack,
): Promise<Eligibility> => {
  if (!programme.provenance?.api || !programme.provenance?.fetchedAt) {
    throw new UnprovenancedProgramme(programme.id)
  }

  const provenance = await verifyProgramme(programme)
  if (provenance.verified === false) throw new AlteredProgramme(programme.id, provenance.reason)

  const verdicts = (programme.criteria ?? []).map((criterion) =>
    evaluateCriterion(criterion, applicant),
  )

  // Conditions published as prose nobody has parsed. An empty criteria array
  // is not "no conditions" — it is "the conditions are not in here", and the
  // difference is an applicant told they qualify for something nobody checked.
  if (programme.conditionsUnparsed) {
    verdicts.push({
      criterion: {
        describe: programme.conditionsUnparsed.reason,
        field: 'conditionsUnparsed',
        id: 'conditions-unparsed',
        op: 'eq',
        value: true,
      },
      reason: `${programme.conditionsUnparsed.reason}${programme.conditionsUnparsed.url ? ` — read them at ${programme.conditionsUnparsed.url}` : ''}`,
      status: 'undecidable',
    })
  }

  /**
   * Zero conditions is not "qualifies for everything".
   *
   * The loaders mark a programme whose conditions are published as prose, and
   * that marker is what stops an empty criteria list assessing as eligible
   * for everybody. It travelled as far as storage and no further: the stored
   * collection had no column for it, so an EU call read back from the
   * database came out with no conditions and no marker and was reported
   * eligible — the exact failure the loader's own docstring warns about,
   * reintroduced one layer down.
   *
   * Storing it is fixed too. This is the part that does not depend on every
   * future storage path remembering: silence about conditions is undecidable
   * here, wherever the record came from. A programme genuinely open to all
   * says so with a criterion, because an authority that published "no
   * conditions" published something.
   */
  if ((programme.criteria ?? []).length === 0 && !programme.conditionsUnparsed) {
    verdicts.push({
      criterion: {
        describe: 'no conditions are recorded for this programme',
        field: 'criteria',
        id: 'conditions-absent',
        op: 'eq',
        value: true,
      },
      reason:
        'no conditions are recorded for this programme, which is not the same as the authority publishing none — nothing here has been checked against the applicant',
      status: 'undecidable',
    })
  }

  const met = verdicts.filter((verdict) => verdict.status === 'met')
  const unmet = verdicts.filter((verdict) => verdict.status === 'unmet')
  const undecidable = verdicts.filter((verdict) => verdict.status === 'undecidable')

  const guardianship = assessGuardianship(applicant, jurisdiction)

  // "Guardianship does not apply" and "guardianship unresolved" both read as
  // undefined through optional chaining, and they are opposite answers.
  const guardianUnresolved = guardianship !== undefined && guardianship.satisfied === undefined
  const guardianRefused = guardianship?.satisfied === false

  const eligible =
    guardianRefused || unmet.length > 0
      ? false
      : undecidable.length > 0 || guardianUnresolved
        ? undefined
        : true

  return {
    eligible,
    ...(guardianship ? { guardianship } : {}),
    met,
    programme: { authority: programme.authority, id: programme.id, name: programme.name },
    provenance: programme.provenance,
    // Undefined where there is no address to check against, never true by
    // omission — the same rule `eligible` follows.
    provenanceVerified: provenance.verified,
    undecidable,
    unmet,
  }
}

/** Every programme this applicant could pursue, most decided first. */
export const assessAll = async (
  programmes: FinancingProgramme[],
  applicant: Applicant,
  jurisdiction?: JurisdictionPack,
): Promise<Eligibility[]> =>
  (await Promise.all(programmes.map((programme) => assess(programme, applicant, jurisdiction))))
    .sort((a, b) => {
      const rank = (value: boolean | undefined) => (value === true ? 0 : value === undefined ? 1 : 2)
      return rank(a.eligible) - rank(b.eligible) || a.undecidable.length - b.undecidable.length
    })
