/**
 * Financing, as data.
 *
 * The programmes are published by EU APIs and by national authorities; they are
 * not written here and must never be. A funding catalogue invented inside a
 * package schools use to answer inspections is the one failure in this codebase
 * that reaches a real school: a school applying against eligibility criteria
 * nobody published loses the money and the time.
 *
 * So every programme carries its provenance, and a programme without it is
 * refused rather than trusted — "nothing invented" as a check the engine runs,
 * not an assurance in a comment.
 *
 * It follows that criteria are data too. A criterion that arrives as JSON from
 * an API cannot be a function, so eligibility is expressed as comparisons over
 * a declared profile and evaluated here. That is also what makes a refusal
 * explainable: an engine that answers "not eligible" without naming the clause
 * is not usable by anyone filling in a form.
 */

/**
 * An applicant is not always an institution.
 *
 * uuidna exists to support independent researchers whatever their age, so the
 * engine assesses an applicant, and a school is one kind of applicant rather
 * than the only kind. A sixteen-year-old applying alone is the case that must
 * work, not the exception handled later.
 */
export type Applicant =
  | ({ kind: 'institution' } & InstitutionProfile)
  | ({ kind: 'researcher' } & ResearcherProfile)

/** Common ground both kinds of applicant stand on. */
export type CommonProfile = {
  /** Anything else stated; criteria may address these by name. */
  attributes?: Record<string, boolean | number | string>
  /** Accreditations, prior participations, statuses a programme may require. */
  holds?: string[]
  /** ISO 3166-1 alpha-2, lower case — matches the jurisdiction pack's `code`. */
  jurisdiction?: string
  /** NUTS region or national equivalent, where a programme is regional. */
  region?: string
}

/**
 * An individual researcher.
 *
 * `age` is optional and stays optional. A programme with no age condition has
 * no business learning one, and asking for a date of birth in order to decide
 * a question that does not turn on it is exactly the collection art. 5(1)(c)
 * forbids. What the engine needs is `isMinor`, which a school's own system can
 * state without disclosing a birthday.
 */
export type ResearcherProfile = CommonProfile & {
  /** Institution, where there is one. An independent researcher has none. */
  affiliation?: string
  age?: number
  /**
   * Evidence that a guardian consented, for an applicant who is a minor.
   * Null means asked and absent; undefined means not established either way.
   */
  guardianConsent?: null | { at: string; evidencedBy: string }
  /** Stated directly, so age itself need not be collected to decide it. */
  isMinor?: boolean
  /** Fields of research, where a programme is discipline-bound. */
  subjects?: string[]
}

/** What a school can state about itself, and what criteria may test. */
export type InstitutionProfile = CommonProfile & {
  pupilCount?: number
  /** Kind of institution as the funding authority classifies it. */
  schoolType?: string
  /** Specialty pack code, e.g. 'vocational-tourism'. */
  specialty?: string
  staffCount?: number
}

/** Retained for callers that assess a school. */
export type SchoolProfile = InstitutionProfile

export type CriterionOperator = 'eq' | 'gte' | 'has' | 'in' | 'lte' | 'neq'

/**
 * One published eligibility condition.
 *
 * `field` names an applicant profile key, or an `attributes` key. `describe` is
 * the condition as the authority words it — carried through so a refusal can
 * quote the source rather than paraphrase it.
 */
export type Criterion = {
  describe: string
  field: string
  id: string
  op: CriterionOperator
  value: boolean | number | string | (boolean | number | string)[]
}

/** A document an application must include. Matched like statutory duties. */
export type RequiredDocument = {
  /** Lower-cased substring matched against document titles. */
  match: string
  name: string
  /** False when the authority accepts a declaration instead of a file. */
  mustBeObtainable?: boolean
}

/**
 * Where a programme came from. Required: a programme that cannot say who
 * published it and when it was read is not admissible evidence for a decision
 * about public money.
 */
export type Provenance = {
  /** The API or register this was read from, e.g. 'eu:funding-tenders'. */
  api: string
  /**
   * Digest of the record as the loader carried it across, sealed at load.
   *
   * Optional because a record may be entered by hand and because rows predate
   * it. Absent means "cannot be decided here", which is what a check reports
   * — never "unchanged".
   */
  contentAddress?: string
  fetchedAt: string
  /** Identifier within that source, so a record can be re-read. */
  reference?: string
  url?: string
}

export type FinancingProgramme = {
  /** Who runs it, as they name themselves. */
  authority: string
  /**
   * Set when the authority publishes its conditions as prose that nothing has
   * parsed into criteria.
   *
   * The EU Funding & Tenders portal does exactly this: a topic's eligibility
   * arrives as a block of HTML. A loader can carry across the identifier, the
   * window and the deadline model faithfully and cannot carry across the
   * conditions, and a programme that arrives with an empty `criteria` array
   * would otherwise assess as eligible for everybody — zero conditions, all of
   * them met.
   *
   * So it is recorded as undecidable instead, which is the true answer: nobody
   * has read the conditions yet. Someone entering them by hand clears it.
   */
  conditionsUnparsed?: { reason: string; url?: string }
  /** Legal instrument, where the programme rests on one. */
  basis?: string
  criteria: Criterion[]
  id: string
  name: string
  /** Stages, in order, as the authority defines them. */
  workflow?: string[]
  provenance: Provenance
  requires?: RequiredDocument[]
  /** Application window. Absent means the authority published none. */
  window?: { closes?: string; opens?: string }
  /**
   * Set when the authority published more than one window for this call.
   *
   * The EU portal returns one row per language for a filtered call, and the
   * rows do not always agree: HORIZON-MSCA-2024-DN-01-01 came back with
   * 2024-11-26T23:00 on its Czech and Bulgarian rows and 2024-11-27T17:00 on
   * its English one — the same topic, eighteen hours apart. Measured across
   * four calls on 2026-09-20: one topic of eighteen.
   *
   * Rare, and a deadline is where rare matters. A loader that keeps whichever
   * language it asked for records one of them and says nothing, so a school
   * plans against a date another row of the same record contradicts. Both are
   * kept here and the answer says so; choosing between them is the school's,
   * against the authority, not a package's to guess.
   */
  windowDisputed?: { closes: string[] }
}

/**
 * The verdict on one criterion.
 *
 * `undecidable` is a first-class outcome, not an error: a school that has not
 * stated its pupil count does not thereby fail a size condition, and must not
 * be told it passed one either.
 */
export type CriterionVerdict = {
  criterion: Criterion
  /** Why, in the authority's words plus what the school actually stated. */
  reason: string
  status: 'met' | 'undecidable' | 'unmet'
}

export type Eligibility = {
  /**
   * True only when every criterion is met. **Undefined when any criterion is
   * undecidable** — never false by default and never true by omission. An
   * applicant told "eligible" on incomplete information applies and is
   * rejected, having spent the effort.
   */
  eligible: boolean | undefined
  /**
   * Guardianship, for a minor applying in their own name. Reported separately
   * from the programme's own criteria because it does not come from the
   * programme: it is owed to the applicant whatever the authority asked for.
   */
  guardianship?: GuardianshipVerdict
  met: CriterionVerdict[]
  programme: { authority: string; id: string; name: string }
  provenance: Provenance
  /**
   * Whether the record still hashes to the address it was sealed with.
   * **Undefined when it carries none** — entered by hand, or loaded before
   * addresses were sealed. A mismatch never reaches here: it throws.
   */
  provenanceVerified: boolean | undefined
  undecidable: CriterionVerdict[]
  unmet: CriterionVerdict[]
}

/**
 * Whether a minor's application may proceed.
 *
 * Supporting researchers whatever their age means a minor applying alone is
 * ordinary. It also means the engine must not wave through an application made
 * in a child's name with nobody accountable for it — and must not pretend to
 * know that consent is absent when it was simply never established. Both are
 * distinguished: `satisfied: false` is refusal, `undefined` is not yet asked.
 */
export type GuardianshipVerdict = {
  reason: string
  required: boolean
  satisfied: boolean | undefined
}

/**
 * A record that no longer matches the address it was sealed with.
 *
 * Refused rather than flagged, and refused harder than a record with no
 * provenance at all: an unprovenanced programme makes no claim about where it
 * came from, while this one makes a claim its own contents contradict.
 */
export class AlteredProgramme extends Error {
  constructor(id: string, reason: string) {
    super(`Financing programme "${id}" is not admissible: ${reason}`)
    this.name = 'AlteredProgramme'
  }
}

export class UnprovenancedProgramme extends Error {
  constructor(id: string) {
    super(
      `Financing programme "${id}" carries no provenance. A programme that cannot name the API it was read from and when is not admissible for a decision about public money, and this package will not evaluate one.`,
    )
    this.name = 'UnprovenancedProgramme'
  }
}
