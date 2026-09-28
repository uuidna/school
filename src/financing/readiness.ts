import type { JurisdictionPack } from '../packs/types.js'
import type { SchoolDocument } from '../sources/types.js'
import type { Applicant, Eligibility, FinancingProgramme, RequiredDocument } from './types.js'

import { assess } from './assess.js'

/**
 * What still stands between an applicant and an application.
 *
 * Eligibility says whether they may apply. This says whether they can — which
 * is a different question and usually the one that actually blocks a school.
 *
 * The distinction the statutory check already draws applies here too: a
 * document that is recorded but cannot be obtained is not evidence. An
 * application assembled from titles is refused by the authority, not by this
 * engine, and by then the window has closed.
 */

export type DocumentReadiness = {
  /** The document found, where one was. */
  document?: SchoolDocument
  required: RequiredDocument
  status: 'missing' | 'ready' | 'recorded-only'
}

export type WindowState = {
  /** Undefined when the authority published no window — not "open". */
  open: boolean | undefined
  reason: string
}

export type ApplicationPlan = {
  /** The single next thing to do, or null when nothing is blocking. */
  blocking: null | string
  documents: DocumentReadiness[]
  eligibility: Eligibility
  programme: { authority: string; id: string; name: string }
  /** Stages as the authority defines them; empty when it published none. */
  stages: string[]
  window: WindowState
}

/**
 * Whether the window is open at `now`.
 *
 * A programme with no published window yields `undefined`, never `true`. An
 * authority that has not opened applications has not opened them, and an
 * engine that assumes otherwise sends a school to a closed door.
 */
export const windowState = (programme: FinancingProgramme, now = new Date()): WindowState => {
  const window = programme.window

  if (!window?.opens && !window?.closes) {
    return { open: undefined, reason: 'the authority published no application window' }
  }

  const at = now.getTime()
  const opens = window.opens ? Date.parse(window.opens) : undefined
  const closes = window.closes ? Date.parse(window.closes) : undefined

  if (opens !== undefined && Number.isNaN(opens)) {
    return { open: undefined, reason: `the published opening date "${window.opens}" could not be read` }
  }
  if (closes !== undefined && Number.isNaN(closes)) {
    return { open: undefined, reason: `the published closing date "${window.closes}" could not be read` }
  }

  if (opens !== undefined && at < opens) {
    return { open: false, reason: `applications open ${window.opens}` }
  }
  if (closes !== undefined && at > closes) {
    return { open: false, reason: `applications closed ${window.closes}` }
  }

  return { open: true, reason: `open${window.closes ? ` until ${window.closes}` : ''}` }
}

/** Which required documents the applicant actually holds, and in what state. */
export const documentReadiness = (
  programme: FinancingProgramme,
  documents: SchoolDocument[],
): DocumentReadiness[] =>
  (programme.requires ?? []).map((required) => {
    const matches = documents.filter((document) =>
      document.title.toLowerCase().includes(required.match),
    )
    const obtainable = matches.find((document) => document.reachable)

    if (obtainable) return { document: obtainable, required, status: 'ready' }

    // Recorded but not obtainable. Only a shortfall where the authority wants
    // the document itself; some accept a declaration.
    if (matches[0]) {
      return {
        document: matches[0],
        required,
        status: required.mustBeObtainable === false ? 'ready' : 'recorded-only',
      }
    }

    return { required, status: 'missing' }
  })

/**
 * Everything needed to decide what to do about one programme.
 *
 * `blocking` names the one next action rather than a list, because a list of
 * eleven things is how an application does not get made. Order is deliberate:
 * a closed window makes the paperwork moot, a refusal makes it moot, and an
 * open question about a child's guardian is settled before anyone is asked to
 * assemble documents in their name.
 */
export const applicationPlan = async (
  programme: FinancingProgramme,
  applicant: Applicant,
  documents: SchoolDocument[] = [],
  now = new Date(),
  jurisdiction?: JurisdictionPack,
): Promise<ApplicationPlan> => {
  const eligibility = await assess(programme, applicant, jurisdiction)
  const window = windowState(programme, now)
  const readiness = documentReadiness(programme, documents)

  const blocking = ((): null | string => {
    if (window.open === false) return `not open: ${window.reason}`

    if (eligibility.guardianship?.satisfied === false) {
      return `guardian consent: ${eligibility.guardianship.reason}`
    }
    if (eligibility.guardianship?.satisfied === undefined && eligibility.guardianship?.required) {
      return `guardian consent: ${eligibility.guardianship.reason}`
    }

    if (eligibility.eligible === false) {
      return `not eligible: ${eligibility.unmet[0]?.reason ?? 'a condition is unmet'}`
    }
    if (eligibility.eligible === undefined) {
      return `undecided: ${eligibility.undecidable[0]?.reason ?? 'a condition cannot be decided here'}`
    }

    const shortfall = readiness.find((entry) => entry.status !== 'ready')
    if (shortfall) {
      return shortfall.status === 'missing'
        ? `missing document: ${shortfall.required.name}`
        : `recorded but not obtainable: ${shortfall.required.name}`
    }

    if (window.open === undefined) return `no published window: ${window.reason}`

    return null
  })()

  return {
    blocking,
    documents: readiness,
    eligibility,
    programme: eligibility.programme,
    stages: programme.workflow ?? [],
    window,
  }
}
