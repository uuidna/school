import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FinancingProgramme } from '../financing/types.js'
import type { SchoolDate } from '../sources/types.js'

import { jurisdictionFor } from '../packs/index.js'
import { sealRoster } from '../sources/roster.js'
import { equip } from './index.js'

// A SCHOOL CANNOT TEACH KNOWLEDGE; IT CAN MAKE THE GROUND WHERE KNOWLEDGE IS
// EXPERIENCED. This package held all four kinds of ground and held them apart:
// a catalogue with provenance, a school year, a class as a roster that names
// nobody, a jurisdiction's provisions. Nothing joined them, so nothing could
// answer the only question that decides whether a class ever stands in a
// river — what is still missing.

// A real Bulgarian year: two terms, September to June, across the new year.
// The first fixture wrote it as one span ending before it started, which is
// what showed that a span was the wrong model in the first place.
const YEAR: SchoolDate[] = [
  { allDay: true, ends: '2027-01-31', id: '1', starts: '2026-09-15', title: 'Първи срок' },
  { allDay: true, ends: '2027-06-30', id: '2', starts: '2027-02-05', title: 'Втори срок' },
]

const CALL: FinancingProgramme = {
  authority: 'European Commission',
  criteria: [],
  id: 'LIFE-2026-SAP-NAT',
  name: 'LIFE Nature and Biodiversity',
  provenance: { api: 'eu:funding-tenders', fetchedAt: '2026-01-10T00:00:00.000Z' },
  window: { closes: '2026-03-01' },
}

// The instruments are the survey's own: a transect tape reads distance, a
// quadrat frame the area it encloses (length again), and a soil thermometer
// the sand's temperature at depth. Stated in SI base quantities because that
// is the only enumeration here nobody chose — and stated by whoever owns the
// instrument, never inferred from its name.
const KARADERE = {
  class: '12a@students.school.bg',
  instruments: [
    { measures: ['length' as const], name: 'transect tape' },
    { measures: ['thermodynamic temperature' as const], name: 'soil thermometer' },
    { measures: ['time' as const], name: 'stopwatch' },
  ],
  place: { name: 'Карадере', permission: 'РИОСВ Варна' },
  purpose: 'Броене на видове по дюните, с местните, за Натура 2000',
  window: { closes: '2027-05-22', opens: '2027-05-04' },
}

const roster = async (n: number) =>
  sealRoster(
    { id: '12a@students.school.bg', name: '12a' },
    [...Array(n)].map((_, i) => ({ id: `pupil-${i}`, role: 'student' as const })),
  )

const ground = (result: ReturnType<typeof equip>, name: string) =>
  result.grounds.find((g) => g.name === name)!

test('a lab with every ground is ready, and says which', async () => {
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )

  assert.equal(result.ready, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(
    result.grounds.map((g) => g.name).sort(),
    ['instruments', 'means', 'people', 'permission', 'time'],
  )
  // Reached, and — just as important — what this place cannot say anything about.
  assert.match(ground(result, 'instruments').reason, /reads time, length, thermodynamic temperature — 3 of 7 SI base quantities/)
  assert.match(ground(result, 'instruments').reason, /says nothing about mass/)
  // The roster is pseudonymous, so this counts and never names.
  assert.match(ground(result, 'people').reason, /18 pupil\(s\)/)
})

test('a call that closes after the study opens cannot fund it', async () => {
  // The arithmetic a deadline list never performs. The money has to be decided
  // before the pupils arrive, and a closing date later than the opening day
  // says plainly that it cannot be.
  const late = { ...CALL, window: { closes: '2027-05-10' } }

  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: late.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [late], roster: await roster(18) },
  )

  assert.equal(result.ready, false)
  assert.match(ground(result, 'means').reason, /closes 2027-05-10, after this study opens 2027-05-04/)
})

test('a window outside the recorded year is named, with the year', async () => {
  const summer = { ...KARADERE, window: { closes: '2027-07-20', opens: '2027-07-06' } }

  const result = equip(
    { ...summer, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )

  assert.equal(ground(result, 'time').present, false)
  assert.match(ground(result, 'time').reason, /sits inside no term the calendar records/)
})

test('a basis the jurisdiction does not carry is refused, not accepted on its look', async () => {
  // A citation that looks like a provision is the cheapest thing to write and
  // the most expensive to be wrong about. It is checked against the pack.
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 999, ал. 1', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )

  assert.equal(ground(result, 'permission').present, false)
  assert.match(ground(result, 'permission').reason, /not among the provisions/)
})

test('a place with no recorded permission is not equipped, however well funded', async () => {
  // Karadere is reachable and that is not the same as permitted. A protected
  // site is entered by agreement with whoever manages it.
  const { permission: _none, ...bare } = KARADERE.place

  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', place: bare, programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )

  assert.equal(result.ready, false)
  assert.match(ground(result, 'permission').reason, /entered by agreement with whoever manages it/)
})

test('an unfunded lab reports what is missing and never that it is invalid', async () => {
  // "Not yet funded" is a fact about a form, not about whether the learning is
  // worth doing. Every ground is returned, present or not, so a reader sees
  // the three that hold rather than only the one that does not.
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2' },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [], roster: await roster(18) },
  )

  assert.equal(result.ready, false)
  assert.equal(result.grounds.length, 5)
  assert.equal(result.grounds.filter((g) => g.present).length, 4)
  assert.match(result.missing[0]!, /school_financing_opportunities lists what this school could apply for/)
})

test('a lab proposed for a class nobody has read is a lab for nobody', async () => {
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL] },
  )

  assert.equal(ground(result, 'people').present, false)
  assert.match(ground(result, 'people').reason, /no roster for 12a@students\.school\.bg/)
})

test('a programme that cannot say where it was published is not means', async () => {
  const invented = { ...CALL, provenance: { api: '', fetchedAt: '' } }

  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: invented.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [invented], roster: await roster(18) },
  )

  assert.equal(ground(result, 'means').present, false)
  assert.match(ground(result, 'means').reason, /not admissible for a decision about public money/)
})

// AN UNMET GROUND MUST CARRY ITS REMEDY. The mutation battery found this gap:
// the reason text of a failing ground could be reduced to a bare label and every
// test still passed, because nothing asserted that a finding tells the reader
// what to do next. "Not equipped" without a next step is the same dead end as
// an error that says "Something went wrong."
test('every unmet ground names what to do about it, not only that it is unmet', async () => {
  const bare = equip(
    { class: 'x', place: { name: 'Реката' }, purpose: 'да гледаме', window: { closes: '2027-07-20', opens: '2027-07-01' } },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [] },
  )

  assert.equal(bare.ready, false)
  assert.equal(bare.grounds.filter((g) => g.present).length, 0, 'the fixture is meant to fail every ground')

  for (const ground of bare.grounds) {
    // A remedy is an imperative or a named door: something the reader can act
    // on. A label is not.
    // A REMEDY IS A THING TO DO, and this is a proxy for one: an imperative a
    // reader can start, or a door in this package they can open. The list is
    // declared rather than a pattern tuned until the suite went green — when a
    // ground genuinely needs a verb that is not here, it is added deliberately
    // and the addition is visible in the diff.
    const REMEDIES = ['state ', 'cite ', 'name ', 'move ', 'read ', 'load ', 'fold ', 'by agreement', 'before planning']
    assert.ok(
      REMEDIES.some((verb) => ground.reason.includes(verb)) || /school_\w+/.test(ground.reason),
      `the "${ground.name}" ground says "${ground.reason}" — a finding with no next step cannot be acted on`,
    )
    assert.ok(ground.reason.length > 30, `the "${ground.name}" ground's reason is too short to carry a remedy`)
  }
})

test('nothing here proposes a study', async () => {
  // The discipline of the module: a purpose and a place come from people who
  // know the ground. What is returned is what was handed in, bounded.
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )

  assert.equal(result.lab.purpose, KARADERE.purpose)
  assert.equal(result.lab.place, 'Карадере')
})

// A WINDOW THAT CLOSES BEFORE IT OPENS IS NOT A WINDOW, and the term test
// cannot see it: `opens >= starts && closes <= ends` holds for any two dates
// inside the term, in either order. A study proposed from 22 May to 4 May
// passed, and the ground reported it back with the dates printed backwards.
//
// It does not stop at a wrong sentence. The MEANS ground asks whether a call
// closes after the study OPENS, so an inverted window puts that comparison
// against the wrong end, and a call that cannot fund the study reads as one
// that can.
test('a window that closes before it opens is refused, not read backwards', async () => {
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id, window: { closes: '2027-05-04', opens: '2027-05-22' } },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )

  assert.equal(ground(result, 'time').present, false)
  assert.match(ground(result, 'time').reason, /closes 2027-05-04 before it opens 2027-05-22/)
  assert.match(ground(result, 'time').reason, /swapped/, 'and says what to check')
  assert.equal(result.ready, false)
})

test('a study lasting one day is short, not inverted — and still passes', async () => {
  // The check refuses a window that runs backwards, never one that is brief.
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id, window: { closes: '2027-05-04', opens: '2027-05-04' } },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [CALL], roster: await roster(18) },
  )
  assert.equal(ground(result, 'time').present, true)
})

// THE SAME QUESTION, THE OTHER DATE PAIR. A CALL whose own window runs
// backwards cannot say when it closes — which is a different answer from "it
// closes too late", and the deadline test collapsed the two: `closes > opens`
// was false, so it fell through to "funded". Money reasoned about from a
// malformed record is what the provenance check guards one layer up; this is
// the same fault arriving as two dates rather than as an altered address.
test('a call whose own window runs backwards cannot be assessed, and says so', async () => {
  const backwards = { ...CALL, window: { closes: '2027-01-01', opens: '2027-12-01' } }
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [backwards], roster: await roster(18) },
  )

  assert.equal(ground(result, 'means').present, false)
  assert.match(ground(result, 'means').reason, /closes 2027-01-01 before it opens 2027-12-01/)
  assert.match(ground(result, 'means').reason, /cannot be assessed/, 'unassessable, not merely too late')
  assert.match(ground(result, 'means').reason, /Re-read the call/, 'and names where to re-read it')
})

test('a call open for a single day is assessable, not malformed', async () => {
  const oneDay = { ...CALL, window: { closes: '2027-04-01', opens: '2027-04-01' } }
  const result = equip(
    { ...KARADERE, basis: 'ЗПУО чл. 263, ал. 2, т. 2', programme: CALL.id },
    { calendar: YEAR, law: jurisdictionFor('bg'), programmes: [oneDay], roster: await roster(18) },
  )
  assert.equal(ground(result, 'means').present, true, 'brief is not backwards')
})
