import { sealProgramme } from './provenance.js'
import type { FinancingProgramme } from './types.js'

/**
 * National programmes, where the state does not publish them as data.
 *
 * This loader exists in the shape it does because of what looking for an API
 * turned up. Bulgaria's национални програми за развитие на образованието are
 * approved by a Council of Ministers decision and published as documents —
 * twenty-four of them for 2026, under РМС № 278 от 09.04.2026 г. The national
 * open-data portal (data.egov.bg) has a working action-style API and does not
 * carry them; strategy.bg serves the list as HTML with no JSON, CSV or XML.
 *
 * So there is nothing to fetch, and a loader that scraped the prose into
 * criteria would be inventing eligibility — the one thing this package must
 * not do. What it can do is make the alternative honest: a school declares its
 * catalogue, and the catalogue must name the act that approved it.
 *
 * That requirement is the whole value. A list of programmes with no approving
 * act is indistinguishable from a list somebody typed from memory, and these
 * are revised every year: a 2025 catalogue read in 2026 describes programmes
 * that no longer exist, and would do so silently. `staleness` makes the age
 * visible rather than leaving it to be noticed.
 */

/** The instrument that brought a catalogue into force. */
export type ApprovingAct = {
  /** As staff would cite it, e.g. 'РМС № 278 от 09.04.2026 г.' */
  act: string
  /** ISO date of the decision. */
  date: string
  url?: string
}

export type NationalProgrammeEntry = {
  /** Budget in the currency the act states, for reporting only. */
  budget?: { amount: number; currency: string }
  closes?: string
  /** Stable identifier — the programme's number under the act, or its slug. */
  id: string
  name: string
  opens?: string
  /** Where the programme's own conditions are published. */
  url?: string
}

export type NationalCatalogue = {
  approvedBy: ApprovingAct
  /** Who administers them, as they name themselves. */
  authority: string
  /** ISO 3166-1 alpha-2, lower case — matches the jurisdiction pack. */
  jurisdiction: string
  programmes: NationalProgrammeEntry[]
  /** The year these programmes are for. Revised annually in most systems. */
  year: number
}

export class UnapprovedCatalogue extends Error {
  constructor(reason: string) {
    super(
      `National programme catalogue refused: ${reason}. A list of programmes that cannot name the act approving it is indistinguishable from a list somebody typed from memory, and a school applying against one loses the money and the work.`,
    )
    this.name = 'UnapprovedCatalogue'
  }
}

export type Staleness = {
  /** Years between the catalogue and the date it is being read on. */
  behind: number
  reason: string
  stale: boolean
}

/**
 * How old this catalogue is relative to when it is read.
 *
 * Reported rather than enforced: a school reading January's catalogue in
 * December is fine, and one reading last year's in June is not, and only the
 * school knows which of those it is doing. What must not happen is neither of
 * them noticing.
 */
export const staleness = (catalogue: NationalCatalogue, now = new Date()): Staleness => {
  const behind = now.getUTCFullYear() - catalogue.year

  if (behind <= 0) {
    return { behind, reason: `catalogue is for ${catalogue.year}`, stale: false }
  }

  return {
    behind,
    reason: `catalogue is for ${catalogue.year} and is being read in ${now.getUTCFullYear()} — national programmes are revised annually, so these may have been superseded by a later act`,
    stale: true,
  }
}

/**
 * A declared catalogue as programmes the engine can assess.
 *
 * Conditions are marked unparsed for the same reason the EU loader marks them:
 * the authority publishes them as prose. An empty `criteria` array would read
 * as "no conditions", and every school would qualify for everything.
 */
export async function loadNationalProgrammes(
  catalogue: NationalCatalogue,
  now = new Date(),
): Promise<FinancingProgramme[]> {
  const act = catalogue.approvedBy

  if (!act?.act?.trim()) throw new UnapprovedCatalogue('no approving act is named')
  if (!act.date || Number.isNaN(Date.parse(act.date))) {
    throw new UnapprovedCatalogue(`the approving act "${act.act}" carries no readable date`)
  }
  if (!catalogue.programmes?.length) throw new UnapprovedCatalogue('it lists no programmes')

  const age = staleness(catalogue, now)
  const fetchedAt = new Date(act.date).toISOString()

  // Sealed as they are built, so a catalogue row altered after the act that
  // approved it stops being admissible rather than merely looking older.
  return Promise.all(catalogue.programmes.map(async (entry): Promise<FinancingProgramme> => {
    const unparsed = age.stale
      ? `the authority publishes this programme's conditions as prose, and ${age.reason}`
      : "the authority publishes this programme's conditions as prose, so no condition here has been checked against the applicant"

    // api is namespaced by jurisdiction — a national catalogue is not the
    // EU's — and fetchedAt is the act's own date, because a catalogue is as
    // fresh as its approval and not as the moment somebody read the file.
    return sealProgramme({
      authority: catalogue.authority,
      basis: act.act,
      conditionsUnparsed: { reason: unparsed, ...(entry.url ? { url: entry.url } : {}) },
      criteria: [],
      id: entry.id,
      name: entry.name,
      provenance: {
        api: `national:${catalogue.jurisdiction}`,
        fetchedAt,
        reference: act.act,
        ...(act.url ? { url: act.url } : {}),
      },
      ...(entry.opens || entry.closes
        ? {
            window: {
              ...(entry.closes ? { closes: entry.closes } : {}),
              ...(entry.opens ? { opens: entry.opens } : {}),
            },
          }
        : {}),
    })
  }))
}
