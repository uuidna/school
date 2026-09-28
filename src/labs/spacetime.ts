import { canonical, sha256 } from '../fair/hash.js'
import { bounded } from '../sources/untrusted.js'

/**
 * Folding a place and a time into one address, with no equipment but the mind.
 *
 * THE GROUND THIS COMPLETES. `equip()` asks whether a lab can put an instrument
 * in a pupil's hands, and a lab that can put none there reaches no SI base
 * quantity. True — and it is not the whole truth, because it would write off
 * every observation a person makes with their own senses: which way the wind
 * blew, what was flowering, whether the soil smelled sour, how many birds. A
 * school that only counts what a meter reads has decided its pupils are worse
 * observers than its cupboard.
 *
 * What makes such an observation usable is not equipment. It is that the
 * observation is PLACED, TIMED, and recorded so it cannot be rewritten
 * afterwards — and that two people who were in the same place at the same time
 * can be compared. All three are arithmetic, and a person supplies the input
 * from what they already know: where they are and roughly when. Nothing else.
 *
 * SO THE FOLD IS THE INSTRUMENT. `spacetimeOf` folds a place and a moment into
 * one address, the same construction as the roster handle: a domain-separated,
 * length-prefixed canonical join, hashed. Two observers who name the same place
 * and the same moment, to the same declared resolution, compute the SAME
 * address without consulting each other, a server, or anything else. Their
 * records then FUSE on it. That is the whole mechanism.
 *
 * RESOLUTION IS DECLARED, BECAUSE YOU CANNOT FOLD FINER THAN YOU KNOW. A person
 * without a clock knows the day; with one, the hour. An address folded to the
 * second from a memory of "that morning" would be precise and false, and two
 * observers of one event would never meet. So the moment is TRUNCATED to a
 * stated resolution before folding, and the resolution travels with the
 * address — a comparison across two resolutions is refused rather than
 * silently made at the finer one.
 *
 * WHAT THIS DOES NOT DO, stated because the omission is load-bearing. It does
 * not verify that anybody was anywhere. An address is a name for a place-and-
 * time, not evidence of presence, and this package has no way to check presence
 * and does not pretend to. It also does not fuse two NAMES for one place:
 * "Карадере" and "Karadere" fold differently, which is a fact about language
 * and not about the coast. Both limits are reported by the functions below
 * rather than left for a reader to discover.
 */

const DOMAIN = 'uuidna/school/spacetime/v1'

/**
 * How finely a moment is known.
 *
 * Ordered coarse to fine, and the order is used: a comparison is only ever made
 * at a resolution both sides declared.
 */
export const RESOLUTIONS = ['day', 'hour', 'minute'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

/** How many characters of an ISO-8601 instant survive at each resolution. */
const KEEP: Record<Resolution, number> = { day: 10, hour: 13, minute: 16 }

export type Spacetime = {
  /** 32 hex characters — 128 bits, the same width as an address. */
  address: string
  /** The place name as it was folded: collapsed and lower-cased, never invented. */
  place: string
  /** The instant as it was folded, truncated to `resolution`. */
  moment: string
  resolution: Resolution
}

/**
 * The place name, normalised exactly as far as is safe.
 *
 * Whitespace collapses and case folds, because "Карадере " and "карадере" are
 * one place written twice by two tired people. Nothing else is touched: no
 * transliteration, no stripping of accents, no synonym table. Every one of
 * those would silently fuse two places a local would tell you are different,
 * and a wrong fusion is worse than a missed one — a missed fusion leaves two
 * records to reconcile by hand, a wrong one merges observations of two rivers.
 */
const normalisedPlace = (place: string): string => bounded(place).toLocaleLowerCase()

/** The moment, truncated to what the observer actually claims to know. */
const truncated = (moment: string, resolution: Resolution): string => moment.slice(0, KEEP[resolution])

/**
 * Fold a place and a moment into one address.
 *
 * Deterministic and offline: the same inputs give the same 128 bits on any
 * machine, in any year, with no server and no clock of its own.
 */
export const spacetimeOf = async (
  place: string,
  moment: string,
  resolution: Resolution = 'day',
): Promise<Spacetime> => {
  const p = normalisedPlace(place)
  const m = truncated(moment, resolution)
  const address = (await sha256(canonical([DOMAIN, resolution, p, m]))).slice(0, 32)
  return { address, moment: m, place: p, resolution }
}

/**
 * An observation made by a person, with whatever they had.
 *
 * `by` is a roster handle, never a name or an address — the roster is
 * pseudonymous and an observation must not be the thing that undoes that.
 * `saw` is the observer's own words and is treated as untrusted text: bounded,
 * never parsed, never acted on.
 */
export type Observation = {
  by: string
  moment: string
  place: string
  resolution?: Resolution
  saw: string
}

export type Fused = {
  /** The spacetime every observation in this group folded to. */
  at: Spacetime
  /** Who observed, by handle, in the order they are given. */
  by: string[]
  /** What each said, bounded. Independent accounts, never merged into one. */
  accounts: { by: string; saw: string }[]
  /** True once more than one observer reached the same address. */
  corroborated: boolean
}

export type Fusion = {
  fused: Fused[]
  /**
   * Why a reading here is not a claim about the world: observations that share
   * an address were made in a place and time somebody NAMED the same way. This
   * package cannot check that anyone was there.
   */
  honest: string
  /** Resolutions present, when they differ — a comparison across them is refused. */
  mixedResolutions: Resolution[]
}

const HONEST =
  'Observations fuse when the place and moment they NAME fold to one address. That is agreement about a label, ' +
  'not evidence that anybody was present: this package cannot check presence and does not try. Two spellings of ' +
  'one place fold apart, which is a fact about language, not about the place.'

/**
 * Group observations by the spacetime they fold to.
 *
 * MIXED RESOLUTIONS ARE NAMED, NOT RECONCILED. Folding a day-resolution and an
 * hour-resolution account to a common coarser one would be this package
 * choosing what an observer knew, which it may not do. They stay apart and the
 * fact is reported, so a person can ask the observers rather than being handed
 * a merge nobody authorised.
 */
export const fuse = async (observations: readonly Observation[]): Promise<Fusion> => {
  const groups = new Map<string, Fused>()
  const resolutions = new Set<Resolution>()

  for (const observation of observations) {
    const resolution = observation.resolution ?? 'day'
    resolutions.add(resolution)
    const at = await spacetimeOf(observation.place, observation.moment, resolution)
    const held = groups.get(at.address)
    const account = { by: observation.by, saw: bounded(observation.saw) }

    if (held) {
      held.accounts.push(account)
      if (!held.by.includes(observation.by)) held.by.push(observation.by)
      // ONE OBSERVER TWICE IS NOT CORROBORATION. Someone who writes the same
      // place and moment down twice has agreed with themselves, which is the
      // vacuity this package refuses everywhere else.
      held.corroborated = held.by.length > 1
    } else {
      groups.set(at.address, { accounts: [account], at, by: [observation.by], corroborated: false })
    }
  }

  return {
    fused: [...groups.values()],
    honest: HONEST,
    mixedResolutions: resolutions.size > 1 ? RESOLUTIONS.filter((r) => resolutions.has(r)) : [],
  }
}
