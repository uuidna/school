import type { FinancingProgramme } from '../financing/types.js'
import type { JurisdictionPack } from '../packs/types.js'
import type { ClassRoster, SchoolDate } from '../sources/types.js'

import type { Instrument } from './nature.js'

import { natureReach } from './nature.js'
import { bounded } from '../sources/untrusted.js'

/**
 * A lab, and what it means for one to be equipped.
 *
 * A school cannot teach knowledge; it can make the ground where knowledge is
 * experienced. So a lab here is not a room of instruments — it is a real place
 * with real people in it for a real stretch of time, paid for and permitted.
 * Discovering a river tells a pupil what a tank never will, and the reason
 * schools reach for the tank is almost never pedagogy: it is that the river
 * needs funding, a legal basis, a window in the year and somebody answerable.
 *
 * Those four are the equipment. This package already holds each of them and
 * held them apart: a catalogue of calls with provenance, a school year, a
 * class as a roster that names nobody, and a jurisdiction's statutory duties.
 * Nothing joined them, so nothing could answer the only question that decides
 * whether a class ever stands in that river — WHAT IS STILL MISSING.
 *
 * NOTHING HERE IS INVENTED, and that is the whole discipline of the file. It
 * does not propose a study, choose a place, or pick a programme. A purpose and
 * a place come from people who know the ground; a programme comes from an
 * authority that published it; a basis comes from the text of a law. What this
 * computes is the gap between what somebody has proposed and what a class
 * would need in order to go — and it reports that gap as findings, never as a
 * verdict, because "not yet funded" is a fact about a form and not about
 * whether the learning is worth doing.
 */

export type Lab = {
  /** The class that would stand in it, as the roster addresses one. */
  class: string
  /** Why, in the words of whoever proposed it. Never generated here. */
  purpose: string
  /** Where, and who permits access when the place needs permitting. */
  place: { name: string; permission?: string }
  /** A programme id the catalogue holds, when one has been identified. */
  programme?: string
  /** The provision that permits learning off the school's own premises. */
  basis?: string
  /** When, as ISO dates. */
  window: { closes: string; opens: string }
  /**
   * What a pupil can read while standing there, as the instrument's owner
   * states it. Optional, and its absence is reported rather than assumed
   * either way: a lab that records no instrument has not said what it
   * reaches, which is not the same as reaching nothing.
   */
  instruments?: Instrument[]
}

export type Ground = {
  /** What this ground is, in one word a reader can act on. */
  name: 'instruments' | 'means' | 'people' | 'permission' | 'time'
  present: boolean
  /** What is true, or what is missing and who can supply it. */
  reason: string
}

export type Equipped = {
  /** Every ground, present or not — never only the failures. */
  grounds: Ground[]
  lab: { class: string; place: string; purpose: string }
  /** What to obtain, in the order a school can actually obtain it. */
  missing: string[]
  /** True only when every ground is present. Never true by omission. */
  ready: boolean
}

/**
 * Does the window sit inside a term the school keeps?
 *
 * ASKED PER TERM, NOT AGAINST A SPAN, because a school year is not one
 * interval. It runs September to June, so the earliest start is later in the
 * calendar than the latest end and a min-to-max reading of the same dates is
 * an inverted range that rejects every date in it — which is exactly what the
 * first version of this did, and the fixture caught it by proposing a study in
 * May.
 *
 * A term is an entry with both a start and an end. Anything else the calendar
 * carries — a single closure, a deadline, a day off — is not a container for
 * three weeks of work and is not treated as one.
 */
const insideTheYear = (window: Lab['window'], calendar: SchoolDate[]): null | string => {
  /**
   * A WINDOW THAT CLOSES BEFORE IT OPENS IS NOT A WINDOW, and the term test
   * cannot see that: `opens >= starts && closes <= ends` is satisfied by any
   * pair of dates inside the term, in either order. A study proposed from
   * 22 May to 4 May passed, and the ground reported it back with the dates
   * printed backwards — "2027-05-22 to 2027-05-04, inside the recorded year".
   *
   * It does not stop at a wrong sentence. The MEANS ground asks whether a
   * call closes after the study OPENS, so an inverted window has that
   * comparison made against the wrong end of it, and a call that cannot fund
   * the study reads as one that can.
   *
   * Asked first, because "inside the year" is a question about a window and
   * there is no window here to ask it about.
   */
  if (window.closes < window.opens) {
    return `the window closes ${window.closes} before it opens ${window.opens} — a study cannot end before it starts; check the two dates have not been swapped`
  }

  const terms = calendar.filter((entry) => entry.starts && entry.ends)
  if (terms.length === 0) {
    return 'the school has recorded no term with both a start and an end, so nothing here can say whether these dates are in term'
  }

  const held = terms.find((term) => window.opens >= term.starts! && window.closes <= term.ends!)
  if (held) return null

  const named = terms.map((t) => `${t.starts} to ${t.ends}`).join(', ')
  // THE TERMS ARE NAMED SO THE READER CAN MOVE, and the move is said out loud:
  // a finding that stops at "no term contains this" leaves a person holding a
  // true sentence and no next step, which is the same dead end as an error that
  // says only that something went wrong.
  return `the window ${window.opens} to ${window.closes} sits inside no term the calendar records (${named}) — ` +
    'move the window inside one of them, or read the term that covers it from the school calendar if it is not recorded here'
}

/**
 * What a proposed lab still needs.
 *
 * Each ground is answered from a source this package already reads, so a
 * finding here is the same fact the relevant tool would report on its own —
 * one place to look instead of four, and no second opinion that can disagree
 * with the first.
 */
export const equip = (
  lab: Lab,
  held: {
    calendar: SchoolDate[]
    law?: JurisdictionPack
    programmes: FinancingProgramme[]
    roster?: ClassRoster
  },
): Equipped => {
  const grounds: Ground[] = []

  // PEOPLE — a class with pupils in it. A lab proposed for a class the roster
  // does not know is a lab for nobody, and the roster is pseudonymous, so this
  // asks how many rather than who.
  const pupils = held.roster?.class.students ?? 0
  grounds.push({
    name: 'people',
    present: pupils > 0,
    reason: pupils > 0
      ? `${pupils} pupil(s) in ${lab.class}`
      : `no roster for ${lab.class} — read it from the school's own system before planning a study for it`,
  })

  // TIME — inside the year the school keeps. A study booked across the summer
  // is a study nobody attends.
  const timeFault = insideTheYear(lab.window, held.calendar)
  grounds.push({
    name: 'time',
    present: timeFault === null,
    reason: timeFault ?? `${lab.window.opens} to ${lab.window.closes}, inside the recorded year`,
  })

  // MEANS — a programme this school actually holds, with provenance, whose
  // money can arrive before the pupils do. A call that closes AFTER the study
  // begins cannot fund it, which is the arithmetic a deadline list alone never
  // performs.
  const programme = lab.programme
    ? held.programmes.find((entry) => entry.id === lab.programme)
    : undefined

  if (!lab.programme) {
    grounds.push({
      name: 'means',
      present: false,
      reason: 'no programme identified — school_financing_opportunities lists what this school could apply for',
    })
  } else if (!programme) {
    grounds.push({
      name: 'means',
      present: false,
      reason: `the catalogue holds no programme "${bounded(lab.programme)}" — load it before planning against it`,
    })
  } else if (!programme.provenance?.api) {
    grounds.push({
      name: 'means',
      present: false,
      reason: `"${bounded(programme.name)}" cannot say where it was published, so it is not admissible for a decision about public money`,
    })
  } else if (
    programme.window?.closes &&
    programme.window.opens &&
    programme.window.closes < programme.window.opens
  ) {
    /**
     * THE CALL'S OWN WINDOW RUNS BACKWARDS, so nothing here can say when it
     * closes — which is a different answer from "it closes too late", and
     * collapsing the two is what this whole file refuses to do.
     *
     * The deadline test below asks whether the call closes after the study
     * opens. On an inverted window that comparison is made against a date the
     * call does not actually close on, and it quietly returns "funded". Money
     * reasoned about from a malformed record is the failure the provenance
     * check guards one layer up; this is the same fault arriving as two dates
     * rather than as an altered address.
     */
    grounds.push({
      name: 'means',
      present: false,
      reason: `"${bounded(programme.name)}" records a window that closes ${programme.window.closes} before it opens ${programme.window.opens} — nothing here can say when it closes, so it cannot be assessed. Re-read the call from ${bounded(programme.provenance?.api ?? 'its authority')}`,
    })
  } else if (programme.window?.closes && programme.window.closes > lab.window.opens) {
    grounds.push({
      name: 'means',
      present: false,
      reason: `"${bounded(programme.name)}" closes ${programme.window.closes}, after this study opens ${lab.window.opens} — the application cannot be decided before the pupils arrive`,
    })
  } else {
    grounds.push({
      name: 'means',
      present: true,
      reason: `"${bounded(programme.name)}", published by ${bounded(programme.authority)}`,
    })
  }

  // PERMISSION — the provision that allows learning away from the premises,
  // and the place's own consent where the place requires one. Neither is
  // guessed: a basis this package composed would be a basis no inspector
  // recognises.
  const cited = lab.basis
    ? held.law?.publications.some((duty) => duty.basis === lab.basis || duty.name === lab.basis)
    : false

  if (!lab.basis) {
    grounds.push({
      name: 'permission',
      present: false,
      reason: 'no legal basis cited — name the provision that permits this, as the jurisdiction cites it',
    })
  } else if (held.law && !cited) {
    grounds.push({
      name: 'permission',
      present: false,
      reason: `"${bounded(lab.basis)}" is not among the provisions ${held.law.name} records, so it cannot be checked here — cite one the pack carries, or add it to the pack from the text`,
    })
  } else if (lab.place.permission === undefined) {
    grounds.push({
      name: 'permission',
      present: false,
      reason: `${bounded(lab.place.name)} has no recorded permission — a protected site is entered by agreement with whoever manages it`,
    })
  } else {
    grounds.push({
      name: 'permission',
      present: true,
      reason: `${bounded(lab.basis)}, and ${bounded(lab.place.name)} by ${bounded(lab.place.permission)}`,
    })
  }

  // INSTRUMENTS — what a pupil can read while standing there. The four grounds
  // above are all about a form being in order, and a study can satisfy every
  // one of them and still be an outing: somewhere to stand, and nothing anyone
  // can measure from it. A school cannot teach knowledge; it makes the ground
  // where knowledge is experienced in full senses, and a sense made exact is
  // an instrument. The denominator is the SI's seven base quantities, which is
  // the one part of this nobody here chose.
  const reach = natureReach(lab.instruments ?? [])
  const instruments = lab.instruments ?? []

  if (instruments.length === 0) {
    grounds.push({
      name: 'instruments',
      present: false,
      reason: 'no instrument recorded — state what each instrument measures, in SI base quantities, or fold the pupils\' own observations with spacetimeOf so that unaided accounts are still placed, timed and comparable',
    })
  } else if (reach.reached.length === 0) {
    grounds.push({
      name: 'instruments',
      present: false,
      reason: `${instruments.length} instrument(s) recorded and none states a quantity the SI defines` +
        (reach.unrecognised.length > 0
          ? ` — ${reach.unrecognised.map((u) => `${bounded(u.instrument)} states "${bounded(u.stated)}"`).join('; ')}. A derived reading is stated as the base quantities it is composed of`
          : ''),
    })
  } else {
    grounds.push({
      name: 'instruments',
      present: true,
      reason: `reads ${reach.reached.join(', ')} — ${reach.reached.length} of ${reach.of} SI base quantities` +
        (reach.unreached.length > 0 ? `; this place says nothing about ${reach.unreached.join(', ')}` : ''),
    })
  }

  return {
    grounds,
    lab: { class: lab.class, place: bounded(lab.place.name), purpose: bounded(lab.purpose) },
    missing: grounds.filter((g) => !g.present).map((g) => g.reason),
    ready: grounds.every((g) => g.present),
  }
}
