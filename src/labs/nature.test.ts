import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SI_BASE, natureReach, schoolNature } from './nature.js'

test('the denominator is the SI\'s, and it is seven', () => {
  assert.equal(SI_BASE.length, 7, 'the SI fixes exactly seven base quantities — a different number here is our list, not theirs')
  assert.deepEqual(
    SI_BASE.map((q) => q.symbol),
    ['s', 'm', 'kg', 'A', 'K', 'mol', 'cd'],
    'the unit symbols are what a pupil reads off the instrument',
  )
})

test('what an instrument reaches is what its owner stated, in SI order', () => {
  const reach = natureReach([
    { measures: ['thermodynamic temperature'], name: 'soil thermometer' },
    { measures: ['length'], name: 'transect tape' },
  ])

  // Reported in the SI's order, not the order they happened to be recorded in,
  // so two schools listing the same instruments read the same sentence.
  assert.deepEqual(reach.reached, ['length', 'thermodynamic temperature'])
  assert.deepEqual(reach.unreached, ['time', 'mass', 'electric current', 'amount of substance', 'luminous intensity'])
  assert.equal(reach.of, 7)
  assert.match(reach.source, /BIPM/)
})

// NOTHING IS INFERRED FROM A NAME. A thermometer reads temperature because its
// maker says so, not because the word contains "thermo" — and a package that
// guessed would be manufacturing a measurement out of spelling.
test('an instrument that states nothing reaches nothing, however it is named', () => {
  const reach = natureReach([{ measures: [], name: 'thermometer' }])
  assert.deepEqual(reach.reached, [])
  assert.equal(reach.unreached.length, 7)
})

test('a quantity outside the seven is REPORTED, never silently dropped', () => {
  // "speed" is real and is not a base quantity. Dropping it would let a school
  // record a cupboard of instruments, read a reach of zero, and have nothing
  // say why — so it is named, with the instrument that stated it.
  const reach = natureReach([{ measures: ['speed' as never], name: 'flow meter' }])
  assert.deepEqual(reach.reached, [])
  assert.deepEqual(reach.unrecognised, [{ instrument: 'flow meter', stated: 'speed' }])
})

test('the school-wide reach names which place reaches each quantity', () => {
  const school = schoolNature([
    { instruments: [{ measures: ['length'], name: 'tape' }], place: { name: 'Карадере' } },
    { instruments: [{ measures: ['length'], name: 'tape' }, { measures: ['mass'], name: 'balance' }], place: { name: 'Двора' } },
    { place: { name: 'Реката' } },
  ])

  assert.equal(school.reached, 2)
  assert.equal(school.of, 7)
  const length = school.byQuantity.find((r) => r.quantity === 'length')!
  assert.deepEqual(length.labs, ['Карадере', 'Двора'], 'both places reach length, each named once')
  const mass = school.byQuantity.find((r) => r.quantity === 'mass')!
  assert.deepEqual(mass.labs, ['Двора'])

  // A lab with no instrument recorded has not said what it reaches. That is
  // not the same as reaching nothing, and the difference belongs to a reader.
  assert.deepEqual(school.silent, ['Реката'])
})

test('every quantity is returned, reached or not — never only the gaps', () => {
  const school = schoolNature([{ instruments: [{ measures: ['time'], name: 'clock' }], place: { name: 'Двора' } }])
  assert.equal(school.byQuantity.length, 7, 'a report of only the failures cannot be read as a census')
  assert.equal(school.byQuantity.filter((r) => r.reached).length, 1)
  assert.equal(school.byQuantity.filter((r) => !r.reached).length, 6)
})

test('one place with two of the same instrument is one place, not two', () => {
  const school = schoolNature([
    { instruments: [{ measures: ['length'], name: 'tape A' }, { measures: ['length'], name: 'tape B' }], place: { name: 'Двора' } },
  ])
  assert.deepEqual(school.byQuantity.find((r) => r.quantity === 'length')!.labs, ['Двора'])
})
