import type { FinancingProgramme } from './types.js'

import { sha256, stableStringify } from '../fair/hash.js'

/**
 * Provenance that can be checked rather than read.
 *
 * `Provenance` carried four strings — which API, when, the reference, the URL
 * — and the engine refused a programme that lacked them. That check asks
 * whether the label is *present*. It cannot ask whether it is *true*, and
 * nothing bound the label to the record it sat on: a deadline edited after
 * the load, a criterion removed, an authority renamed, all keep their
 * provenance block intact and keep being evaluated as though the portal had
 * published them that way.
 *
 * This package content-addresses everything else it has to be able to trust —
 * a receipt, a chain link, a stored image. A financing record decides how a
 * school spends public money and how a sixteen-year-old spends a month of
 * their life on an application. It gets the same treatment.
 *
 * The address covers every field except the provenance block itself, which
 * carries the address and cannot commit to itself. So what is sealed is the
 * decision-relevant record: the conditions, the window, the authority, the
 * workflow — and any change to any of them is arithmetic, not opinion.
 *
 * What this proves and what it does not. It proves the record has not changed
 * since the loader read it. It does NOT prove the authority published it that
 * way: that is decidable only by re-reading the API, which is what
 * `reference` is for. Two different questions, and conflating them would be
 * the same mistake as a receipt that says "verified" while meaning "three of
 * the five steps".
 */

/**
 * The record in the form two systems can agree on.
 *
 * Without this the seal accuses the wrong party. A window stored as a date
 * comes back as `2026-11-04T00:00:00.000Z` where the portal published
 * `2026-11-04` — the same instant, a different string, and an address over raw
 * fields would report a school's whole catalogue as altered on the first read
 * back. A check that cries tampering at a serialisation is worse than no
 * check, because the one time it means it nobody will believe it.
 *
 * So the address is over a stated normal form, and the normal form is part of
 * what "unchanged" means here: same instants, same conditions in the same
 * conditions in any order, same requirements, whitespace and
 * absent-versus-empty not counted, and the stages still in sequence.
 * What it still catches is every change that alters a decision — a moved
 * deadline, an added or removed condition, a different authority, a criterion
 * whose comparison or value changed.
 */
const instant = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : (text || undefined)
}

const trimmed = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

const normalise = (programme: FinancingProgramme): Record<string, unknown> => {
  const window = programme.window
    ? {
        closes: instant(programme.window.closes),
        opens: instant(programme.window.opens),
      }
    : undefined

  return {
    authority: trimmed(programme.authority),
    basis: trimmed(programme.basis),
    // The marker, not its wording: what matters to a decision is that nobody
    // has parsed the conditions, and the sentence saying so is generated.
    conditionsUnparsed: programme.conditionsUnparsed ? true : undefined,
    /**
     * Sorted, and this was wrong the first time it was written.
     *
     * The order was kept, on the reasoning that a list read back in another
     * sequence is a different record. It is not: `assess` evaluates every
     * criterion and combines the verdicts, so reordering two conditions
     * changes no decision — measured, not assumed, by assessing both orders
     * and comparing. What it did change was the address, so a store that
     * returned an array in a different order than it took it would have made
     * a school's entire catalogue inadmissible, with the engine reporting
     * tampering at a record nobody had touched.
     *
     * That is the same fault as hashing a date's spelling, one field along,
     * and it is worse: this one accuses. The address is over what decides,
     * and the order of independent conditions does not.
     */
    criteria: (programme.criteria ?? [])
      .map((criterion) => ({
        field: trimmed(criterion.field),
        id: trimmed(criterion.id),
        op: trimmed(criterion.op),
        value: criterion.value ?? null,
      }))
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    id: trimmed(programme.id),
    name: trimmed(programme.name),
    // Sorted for the same reason: a school assembles the documents a
    // programme requires, and which one is listed first decides nothing.
    requires: (programme.requires ?? [])
      .map((required) => ({
        match: trimmed(required.match),
        mustBeObtainable: required.mustBeObtainable === false ? false : undefined,
        name: trimmed(required.name),
      }))
      .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    window: window?.closes || window?.opens ? window : undefined,
    // NOT sorted. Stages are sequential — "stage 1" then "stage 2" is a
    // different process from the reverse — so here the order genuinely is
    // content, and an authority that reorders its stages has changed the
    // programme.
    workflow: (programme.workflow ?? []).map(trimmed),
  }
}

/**
 * The address of a programme as the loader carried it across.
 *
 * The provenance block is left out: it carries the address and cannot commit
 * to itself, and `fetchedAt` would otherwise make every re-read a different
 * record.
 */
export const programmeAddress = (programme: FinancingProgramme): Promise<string> =>
  sha256(stableStringify(normalise(programme)))

/** The programme with its address sealed into its provenance. */
export const sealProgramme = async (
  programme: FinancingProgramme,
): Promise<FinancingProgramme> => ({
  ...programme,
  provenance: { ...programme.provenance, contentAddress: await programmeAddress(programme) },
})

export type ProvenanceCheck = {
  /** What was recomputed, for an answer that wants to show its working. */
  address?: string
  reason: string
  /**
   * True when the record hashes to the address it carries. **Undefined when
   * it carries none** — a record loaded before this existed, or entered by
   * hand in the admin panel, is not thereby a forgery. Never true by default.
   */
  verified: boolean | undefined
}

export const verifyProgramme = async (
  programme: FinancingProgramme,
): Promise<ProvenanceCheck> => {
  const carried = programme.provenance?.contentAddress

  if (!carried) {
    return {
      reason:
        'this record carries no content address, so whether it has changed since it was read cannot be decided here — it was entered by hand, or loaded before addresses were sealed',
      verified: undefined,
    }
  }

  const address = await programmeAddress(programme)

  return address === carried
    ? { address, reason: 'the record hashes to the address it was sealed with', verified: true }
    : {
        address,
        reason: `this record has changed since it was read from ${programme.provenance.api}: it was sealed as ${carried} and now hashes to ${address}`,
        verified: false,
      }
}
