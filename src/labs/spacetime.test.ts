import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fuse, spacetimeOf } from './spacetime.js'

test('two observers who name the same place and moment fold to the same address, apart', async () => {
  // The whole mechanism: neither consults the other, a server, or a clock of
  // its own. Same inputs, same 128 bits.
  const a = await spacetimeOf('Карадере', '2027-05-04T07:12:00Z', 'day')
  const b = await spacetimeOf('  карадере  ', '2027-05-04T19:48:00Z', 'day')
  assert.equal(a.address, b.address, 'whitespace and case are one place written twice by two tired people')
  assert.equal(a.address.length, 32, '128 bits, the width of an address')
})

test('a different place, or a different day, is a different address', async () => {
  const at = await spacetimeOf('Карадере', '2027-05-04T07:12:00Z', 'day')
  assert.notEqual((await spacetimeOf('Иракли', '2027-05-04T07:12:00Z', 'day')).address, at.address)
  assert.notEqual((await spacetimeOf('Карадере', '2027-05-05T07:12:00Z', 'day')).address, at.address)
})

// YOU CANNOT FOLD FINER THAN YOU KNOW. An address folded to the minute from a
// memory of "that morning" would be precise and false, and two observers of one
// event would never meet.
test('the moment is truncated to the resolution declared, not to the one supplied', async () => {
  assert.equal((await spacetimeOf('x', '2027-05-04T07:12:00Z', 'day')).moment, '2027-05-04')
  assert.equal((await spacetimeOf('x', '2027-05-04T07:12:00Z', 'hour')).moment, '2027-05-04T07')
  assert.equal((await spacetimeOf('x', '2027-05-04T07:12:00Z', 'minute')).moment, '2027-05-04T07:12')

  const day = await spacetimeOf('x', '2027-05-04T07:12:00Z', 'day')
  const hour = await spacetimeOf('x', '2027-05-04T07:12:00Z', 'hour')
  assert.notEqual(day.address, hour.address, 'the resolution is folded in, so a coarse claim is never read as a fine one')
})

test('the default resolution is the coarsest — the one a person needs no instrument for', async () => {
  assert.equal((await spacetimeOf('x', '2027-05-04T07:12:00Z')).resolution, 'day')
})

test('observers of one place and day fuse, and their accounts stay separate', async () => {
  const f = await fuse([
    { by: 'a1b2', moment: '2027-05-04T08:00:00Z', place: 'Карадере', saw: 'вятър от север, пясъчна лилия цъфти' },
    { by: 'c3d4', moment: '2027-05-04T16:00:00Z', place: 'карадере', saw: 'намерих следи от чакал до дюната' },
  ])

  assert.equal(f.fused.length, 1)
  assert.equal(f.fused[0]!.corroborated, true)
  assert.deepEqual(f.fused[0]!.by, ['a1b2', 'c3d4'])
  // Independent accounts, never merged into one sentence: two people saw two
  // things, and a summary would destroy exactly the information fusion is for.
  assert.equal(f.fused[0]!.accounts.length, 2)
  assert.match(f.honest, /not evidence that anybody was present/)
})

test('one observer writing it down twice has agreed with themselves', async () => {
  const f = await fuse([
    { by: 'a1b2', moment: '2027-05-04T08:00:00Z', place: 'Карадере', saw: 'вятър от север' },
    { by: 'a1b2', moment: '2027-05-04T09:00:00Z', place: 'Карадере', saw: 'вятър от север' },
  ])
  assert.equal(f.fused.length, 1)
  assert.equal(f.fused[0]!.corroborated, false, 'agreeing with yourself is the vacuity this package refuses everywhere else')
  assert.deepEqual(f.fused[0]!.by, ['a1b2'])
  assert.equal(f.fused[0]!.accounts.length, 2, 'both accounts are kept — it is the corroboration that is denied, not the record')
})

test('mixed resolutions are named, never reconciled downward', async () => {
  const f = await fuse([
    { by: 'a1b2', moment: '2027-05-04T08:00:00Z', place: 'Карадере', resolution: 'day', saw: 'x' },
    { by: 'c3d4', moment: '2027-05-04T08:00:00Z', place: 'Карадере', resolution: 'hour', saw: 'y' },
  ])
  assert.equal(f.fused.length, 2, 'folding them together would be this package deciding what an observer knew')
  assert.deepEqual(f.mixedResolutions, ['day', 'hour'])
})

test('an observation is identified by handle, never by a name or an address', async () => {
  // The roster is pseudonymous and an observation must not be the thing that
  // undoes that, so what fuses is a handle and what is reported is a handle.
  const f = await fuse([{ by: 'a1b2', moment: '2027-05-04', place: 'Карадере', saw: 'x' }])
  assert.deepEqual(Object.keys(f.fused[0]!.accounts[0]!).sort(), ['by', 'saw'])
})

test('an observer\'s words are bounded, never parsed and never acted on', async () => {
  const f = await fuse([{ by: 'a1b2', moment: '2027-05-04', place: 'Карадере', saw: 'x'.repeat(5000) }])
  assert.ok(f.fused[0]!.accounts[0]!.saw.length < 5000, 'foreign text reaches a reader bounded')
})
