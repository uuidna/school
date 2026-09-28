/**
 * What of nature a lab actually reaches.
 *
 * `equip()` answers whether a class can GO — funded, permitted, rostered, in
 * term. Four grounds, all of them about a form being in order. A study can
 * satisfy every one of them and still be an outing: somewhere to stand, nobody
 * able to read anything while standing there.
 *
 * A school cannot teach knowledge. It can make the ground where knowledge is
 * experienced in full senses — and a sense, made exact, is an instrument. So
 * the question this file adds is the one the other four never ask: STANDING IN
 * THE RIVER, WHAT CAN A PUPIL MEASURE?
 *
 * THE ENUMERATION IS NOT OURS, which is the only reason it can be complete.
 * The SI fixes exactly seven base quantities (BIPM, SI Brochure, 9th edition,
 * 2019), and every other physical quantity is a product of their powers — that
 * is the definition of the system, not a claim about it. So a school's reach
 * into nature is measurable against a closed list somebody else closed, and
 * "which parts of nature can this school let a pupil measure" has an answer
 * with a denominator. A list we wrote ourselves would have had neither.
 *
 * WHAT AN INSTRUMENT MEASURES IS DECLARED, NEVER GUESSED. A thermometer reads
 * temperature because its maker says so and its scale is traceable, not because
 * this file recognised the word. So a lab states what each instrument reads,
 * and a lab that states nothing reaches nothing — reported as absent, never
 * inferred from a name. Guessing here would be the exact failure the package
 * refuses elsewhere: a claim nobody computed, wearing the look of a measurement.
 */

/**
 * The seven, as the SI defines them.
 *
 * Ordered as the SI Brochure orders them. The symbol is the unit's, because
 * that is what appears on an instrument a pupil picks up.
 */
export const SI_BASE = [
  { name: 'time', symbol: 's', unit: 'second' },
  { name: 'length', symbol: 'm', unit: 'metre' },
  { name: 'mass', symbol: 'kg', unit: 'kilogram' },
  { name: 'electric current', symbol: 'A', unit: 'ampere' },
  { name: 'thermodynamic temperature', symbol: 'K', unit: 'kelvin' },
  { name: 'amount of substance', symbol: 'mol', unit: 'mole' },
  { name: 'luminous intensity', symbol: 'cd', unit: 'candela' },
] as const

export const SI_SOURCE = 'BIPM, The International System of Units (SI), 9th edition, 2019'

export type BaseQuantity = (typeof SI_BASE)[number]['name']

/** The seven names, as a set, for membership questions. */
const BASE_NAMES: ReadonlySet<string> = new Set(SI_BASE.map((q) => q.name))

/**
 * An instrument a lab can put in a pupil's hands.
 *
 * `measures` is what its owner says it reads, in SI base quantities. A
 * derived reading is stated as the base quantities it is composed of — a flow
 * meter reads length and time, because that is what it is: the SI has no base
 * quantity for speed and neither does this.
 */
export type Instrument = {
  name: string
  measures: BaseQuantity[]
}

export type NatureReach = {
  /** Base quantities at least one instrument reads. */
  reached: BaseQuantity[]
  /** Base quantities no instrument reads. The gap, named. */
  unreached: BaseQuantity[]
  /** Instruments whose stated quantity is not one of the seven. */
  unrecognised: { instrument: string; stated: string }[]
  /** reached / 7, as a fraction with a denominator somebody else fixed. */
  of: number
  source: string
}

/**
 * What a set of instruments reaches, and what it leaves untouched.
 *
 * Total and pure: no instrument list is an empty reach, never an error. A
 * school with no instruments recorded is not a school that has none — it is a
 * school that has not said, and the difference belongs to the reader.
 */
export const natureReach = (instruments: readonly Instrument[]): NatureReach => {
  const seen = new Set<string>()
  const unrecognised: { instrument: string; stated: string }[] = []

  for (const instrument of instruments) {
    for (const stated of instrument.measures) {
      // AN UNRECOGNISED QUANTITY IS REPORTED, NOT DROPPED. Silently ignoring it
      // would let a school record a cupboard of instruments, read a reach of
      // zero, and have nothing say why. The seven are closed; a name outside
      // them is either a derived quantity that should be decomposed or a typo,
      // and both need a person.
      if (BASE_NAMES.has(stated)) seen.add(stated)
      else unrecognised.push({ instrument: instrument.name, stated })
    }
  }

  const reached = SI_BASE.filter((q) => seen.has(q.name)).map((q) => q.name)
  const unreached = SI_BASE.filter((q) => !seen.has(q.name)).map((q) => q.name)

  return { of: SI_BASE.length, reached, source: SI_SOURCE, unreached, unrecognised }
}

export type SchoolNature = {
  /** Every base quantity, with the labs that reach it — never only the gaps. */
  byQuantity: { labs: string[]; quantity: BaseQuantity; reached: boolean }[]
  /** Labs that record no instrument at all: they say nothing about their reach. */
  silent: string[]
  reached: number
  of: number
  source: string
  unrecognised: { instrument: string; stated: string }[]
}

/**
 * The whole school's reach, across every lab it has proposed.
 *
 * THE DENOMINATOR IS THE POINT. "The school looks incomplete" is an
 * impression; "this school can let a pupil measure four of the seven
 * quantities the SI defines, and cannot reach current, amount of substance or
 * luminous intensity" is a finding someone can act on, and it stops being true
 * the moment a lab records an ammeter. Which is the only kind of statement
 * this package ships.
 */
export const schoolNature = (
  labs: readonly { instruments?: readonly Instrument[]; place: { name: string } }[],
): SchoolNature => {
  const byQuantity = SI_BASE.map((q) => ({ labs: [] as string[], quantity: q.name, reached: false }))
  const index = new Map(byQuantity.map((row) => [row.quantity as string, row]))
  const silent: string[] = []
  const unrecognised: { instrument: string; stated: string }[] = []

  for (const lab of labs) {
    const instruments = lab.instruments ?? []
    if (instruments.length === 0) {
      silent.push(lab.place.name)
      continue
    }
    const reach = natureReach(instruments)
    unrecognised.push(...reach.unrecognised)
    for (const quantity of reach.reached) {
      const row = index.get(quantity)!
      row.reached = true
      // one lab, one mention: two ammeters in the same place is one place with current
      if (!row.labs.includes(lab.place.name)) row.labs.push(lab.place.name)
    }
  }

  return {
    byQuantity,
    of: SI_BASE.length,
    reached: byQuantity.filter((row) => row.reached).length,
    silent,
    source: SI_SOURCE,
    unrecognised,
  }
}
