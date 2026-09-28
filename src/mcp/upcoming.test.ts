import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fakePayload, fakeRequest } from '../payload/testing.js'
import { calendarMcpTools } from './calendar.js'

/**
 * `school_upcoming` — the school year and the money, on one timeline.
 *
 * Two sources that were held apart everywhere else: term dates come from the
 * school's own calendar, closing dates from the financing catalogue. A school
 * that plans a study without seeing the deadline that funds it plans a study
 * nobody pays for, which is the arithmetic equip() performs one lab at a time
 * and this performs for the year.
 *
 * It was covered by the aggregate folds and by no test that named it.
 */
const tool = calendarMcpTools.find((entry) => entry.name === 'school_upcoming')!

const iso = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 3600 * 1000).toISOString()

const upcoming = async (
  dates: Record<string, unknown>[],
  programmes: Record<string, unknown>[] = [],
  args: Record<string, unknown> = {},
) => {
  const { payload } = fakePayload({
    docs: { 'financing-programmes': programmes, 'school-calendar': dates },
  })
  return JSON.parse((await tool.handler(args, fakeRequest(payload) as never)).content[0]!.text)
}

const term = (title: string, days: number) => ({ id: title, starts: iso(days), title })

test('the timeline is sorted by date, whichever source an entry came from', async () => {
  const out = await upcoming([term('Втори срок', 90), term('Първи срок', 10)])

  assert.deepEqual(out.timeline.map((e: { title: string }) => e.title), ['Първи срок', 'Втори срок'])
})

// COUNTED SEPARATELY SO AN EMPTY TIMELINE SAYS WHICH HALF WAS EMPTY. "Nothing
// upcoming" is two different problems — a school that recorded no term dates,
// and one with no funding calls open — and they have different fixes.
test('school dates and deadlines are counted apart', async () => {
  const out = await upcoming([term('Първи срок', 10), term('Ваканция', 20)])

  assert.equal(out.schoolDates, 2)
  assert.equal(out.deadlines, 0, 'no funding call is open, and the report says so rather than implying none exist')
  assert.equal(out.timeline.length, 2)
})

test('a school with no calendar recorded reports zero dates, not an absent field', async () => {
  const out = await upcoming([])
  assert.equal(out.schoolDates, 0)
  assert.deepEqual(out.timeline, [])
  assert.ok(out.from < out.until, 'and still states the window it looked in')
})

// THE WINDOW IS REAL, NOT DECORATIVE. An entry outside it is dropped, or the
// report would answer a different question than the one asked.
test('a date beyond the window is not on the timeline', async () => {
  const out = await upcoming([term('Далечен срок', 500), term('Скоро', 5)])

  assert.equal(out.timeline.length, 1, 'a year ahead by default — 500 days is outside it')
  assert.equal(out.timeline[0].title, 'Скоро')
})

test('the caller may narrow the window, and the report states the one it used', async () => {
  const until = iso(30)
  const out = await upcoming([term('В прозореца', 10), term('Извън него', 60)], [], { until })

  assert.equal(out.until, until, 'the window used is the window reported')
  assert.equal(out.timeline.length, 1)
})

// A DATE WITH NO START CANNOT SIT ON A TIMELINE. Dropping it silently would be
// wrong in the other direction, so it is simply not placed — the calendar tool
// is where a malformed entry is somebody's to fix.
test('a calendar entry with no start date is not placed on the timeline', async () => {
  const out = await upcoming([{ id: 'x', title: 'Без дата' }, term('С дата', 10)])

  assert.equal(out.schoolDates, 1)
  assert.equal(out.timeline[0].title, 'С дата')
})

test('it reads, names where it read from, and asks for the calendar capability', async () => {
  const out = await upcoming([term('Срок', 10)])
  assert.ok(out.readFrom.system, 'which system answered')
  assert.ok(out.readFrom.reason, 'and why that one')
  assert.equal(tool.writes, false)
  assert.deepEqual(tool.needs, ['calendar'])
})
