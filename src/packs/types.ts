/**
 * School packs.
 *
 * A school differs from another school in three ways, and only the third is
 * bespoke: the law it answers to, the kind of school it is, and its own name
 * and content. Packs make the first two data, so a second school is a
 * configuration rather than a fork.
 *
 * The rule for what belongs in a pack: if a hotel or a clinic would need it,
 * it is not school-shaped and does not go here.
 */

/** A document the law obliges the school to publish. */
export type LegalPublication = {
  /** The provision that requires it, quoted as staff would cite it. */
  basis: string
  /** Lower-cased substring matched against document titles. */
  match: string
  /** Human name of the requirement. */
  name: string
}

/** Where a stated legal fact was read, and when. */
export type LegalSource = {
  /** The provision, as staff would cite it. */
  cites: string
  /** When this was last checked against the source. */
  checkedAt: string
  /**
   * How firmly it is established. `secondary` means regulator guidance or
   * legal commentary rather than the text of the act — usable, and flagged,
   * so nobody mistakes it for having been read in Държавен вестник.
   */
  confidence: 'primary' | 'secondary'
  url?: string
}

/**
 * Ages at which this legal system treats a person as acting for themselves.
 *
 * Two different thresholds, for two different acts, and conflating them is how
 * a child is either blocked from something they may do or signed up to
 * something they may not.
 *
 * Both are **optional and fail closed**: a pack that does not state one causes
 * the engine to require a guardian, never to assume one is unnecessary. A
 * number invented here would be worse than the absence of one — European and
 * Bulgarian law are strict about minors, and a wrong threshold in a package
 * schools rely on would be relied upon.
 */
export type AgeThresholds = {
  /**
   * Where these figures come from. Required alongside any stated age, for the
   * same reason a financing programme carries provenance: a legal threshold
   * nobody can trace is not a legal threshold, it is a number in a file.
   */
  source?: LegalSource
  /**
   * GDPR art. 8: the age at which a child may consent to processing by an
   * information society service on their own. The Regulation sets 16 and lets
   * Member States lower it to not below 13, so this is genuinely per-country
   * and must be taken from that country's implementing act, not from the
   * Regulation's default.
   */
  digitalConsent?: number
  /**
   * Legal capacity to make an application in one's own name. Distinct from
   * digital consent: a child old enough to accept a privacy notice is not
   * thereby old enough to enter into a funding commitment.
   */
  majority?: number
}

/** One legal system. Swapping this swaps the compliance engine's expectations. */
export type JurisdictionPack = {
  /** Ages at which a person acts for themselves here. Absent = require a guardian. */
  ages?: AgeThresholds
  /** ISO 3166-1 alpha-2, lower case. */
  code: string
  /** Default locale for a school under this jurisdiction. */
  defaultLocale: string
  /** How long access and audit records are kept, in days. */
  auditRetentionDays: number
  name: string
  publications: LegalPublication[]
  /** Named for the report, e.g. 'Регламент (ЕС) 2016/679 и ЗЗЛД'. */
  dataProtectionRegime: string
}

/** A section of the document tree a school of this kind is expected to keep. */
export type TypologySection = {
  note?: string
  title: string
}

/** One kind of school. Contributes vocabulary and structure, never core logic. */
export type SpecialtyPack = {
  code: string
  /** Staff groupings offered on the teachers collection. */
  departments: { label: string; value: string }[]
  name: string
  /** Starter pages, as markdown, published on provisioning. */
  pages: { markdown: string; slug: string; title: string }[]
  /**
   * Main navigation offered to a new school of this kind.
   *
   * Every entry names a page this pack ships, or carries `provided` saying why
   * it points somewhere no page is — the site root, an endpoint the host
   * mounts. A test walks both packs and fails on an entry that is neither,
   * because publishing the pages and setting the menu are separate steps and
   * nothing else compares them.
   */
  navigation: { label: string; provided?: string; url: string }[]
  /** Sections of the document typology. */
  typology: TypologySection[]
}

export type SchoolDefinition = {
  domain: string
  jurisdiction: string
  name: string
  slug: string
  specialty: string
}
