import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assess } from './assess.js'
import { EU_STATUS, EU_TYPE, loadEuProgrammes, queryBody, toProgramme } from './eu.js'

// THE FILTER FAILING IS SILENT, WHICH IS WHAT MAKES IT DANGEROUS. Sent without
// Content-Type: application/json on the query part, the portal answers 200 and
// returns all 4.2 million records instead of the 16,659 open calls. It looks
// like a working integration having a very good day. These tests pin the
// request shape that was established by calling the live API, so a refactor
// cannot quietly go back to the shape that "works".

const topic = (over: Record<string, string[]> = {}) => ({
  metadata: {
    callIdentifier: ['EU4H-2024-PJ-02'],
    deadlineDate: ['2026-10-09T22:00:00.000+0000'],
    deadlineModel: ['single-stage'],
    identifier: ['EU4H-2024-PJ-02-3'],
    startDate: ['2026-06-17T22:00:00.000+0000'],
    status: [EU_STATUS.open],
    title: ['Call for proposals on social services'],
    type: [EU_TYPE.call],
    url: ['https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/x'],
    ...over,
  },
  reference: '47060011TOPICSbg',
})

const portal = (pages: Record<string, unknown>[][]) => {
  const sent: { body: string; headers: Record<string, string>; url: string }[] = []
  let page = 0

  const fetch = async (url: string, init?: RequestInit) => {
    sent.push({
      body: String(init?.body ?? ''),
      headers: (init?.headers ?? {}) as Record<string, string>,
      url,
    })
    const results = pages[page++] ?? []
    return Response.json({ results, totalResults: results.length })
  }

  return { fetch, sent }
}

test('the query part carries Content-Type: application/json', async () => {
  // The whole discovery. Without it the portal ignores the filter silently.
  const body = queryBody({ bool: { must: [] } }, 'B')

  assert.match(body, /Content-Disposition: form-data; name="query"/)
  assert.match(body, /Content-Type: application\/json/)
  assert.match(body, /\r\n/, 'multipart requires CRLF line endings')
  assert.ok(body.endsWith('--B--\r\n'), 'the closing boundary is malformed')
})

test('the request is multipart, POSTed, and asks for everything by text', async () => {
  const { fetch, sent } = portal([[topic()]])
  await loadEuProgrammes({ fetch: fetch as never, pageSize: 50 })

  assert.equal(sent.length, 1)
  assert.match(sent[0]!.url, /text=\*\*\*/)
  assert.match(sent[0]!.url, /apiKey=SEDIA/)
  assert.match(sent[0]!.headers['content-type']!, /^multipart\/form-data; boundary=/)
})

test('it asks only for what a school could still apply to', async () => {
  const { fetch, sent } = portal([[topic()]])
  await loadEuProgrammes({ fetch: fetch as never, pageSize: 50 })

  const query = JSON.parse(sent[0]!.body.split('\r\n\r\n')[1]!.split('\r\n--')[0]!) as {
    bool: { must: { terms: Record<string, string[]> }[] }
  }
  const terms = Object.fromEntries(
    query.bool.must.map((clause) => Object.entries(clause.terms)[0]!),
  )

  assert.deepEqual(terms.type, [EU_TYPE.grant, EU_TYPE.call])
  // Forthcoming and open. Not closed: a school cannot apply to a closed call.
  assert.deepEqual(terms.status, [EU_STATUS.forthcoming, EU_STATUS.open])
})

test('a caller may narrow without paging the whole Union', async () => {
  const { fetch, sent } = portal([[topic()]])
  await loadEuProgrammes({
    fetch: fetch as never,
    must: [{ terms: { callIdentifier: ['ERASMUS-2026'] } }],
    pageSize: 50,
  })

  assert.match(sent[0]!.body, /ERASMUS-2026/)
})

test('a portal record becomes a programme with its provenance', async () => {
  const programme = toProgramme(topic(), '2026-09-20T00:00:00.000Z')!

  assert.equal(programme.id, 'EU4H-2024-PJ-02-3')
  assert.equal(programme.authority, 'European Commission')
  assert.equal(programme.provenance.api, 'eu:funding-tenders')
  assert.equal(programme.provenance.fetchedAt, '2026-09-20T00:00:00.000Z')
  assert.equal(programme.provenance.reference, 'EU4H-2024-PJ-02')
  assert.match(programme.provenance.url!, /^https:\/\/ec\.europa\.eu\//)
})

test('the published window is carried across, both ends', async () => {
  const programme = toProgramme(topic(), 'now')!

  assert.equal(programme.window!.opens, '2026-06-17T22:00:00.000Z')
  assert.equal(programme.window!.closes, '2026-10-09T22:00:00.000Z')
})

test('a record with no dates gets no window, rather than an invented one', async () => {
  const programme = toProgramme(
    { metadata: { identifier: ['X'], title: ['Y'] }, reference: 'r' },
    'now',
  )!

  assert.equal(programme.window, undefined)
})

test('an unparseable date is dropped rather than becoming Invalid Date', async () => {
  const programme = toProgramme(topic({ deadlineDate: ['whenever'] }), 'now')!

  assert.equal(programme.window!.closes, undefined)
  assert.equal(programme.window!.opens, '2026-06-17T22:00:00.000Z')
})

test("the authority's own deadline model becomes the workflow", () => {
  assert.deepEqual(toProgramme(topic(), 'now')!.workflow, ['single-stage'])
  assert.deepEqual(toProgramme(topic({ deadlineModel: ['two-stage'] }), 'now')!.workflow, [
    'stage 1',
    'stage 2',
  ])
})

test('a record with no identifier or title is skipped, not half-built', async () => {
  assert.equal(toProgramme({ metadata: { title: ['Y'] } }, 'now'), undefined)
  assert.equal(toProgramme({ metadata: { identifier: ['X'] } }, 'now'), undefined)
})

test('eligibility is never claimed from a call nobody has read', async () => {
  // The portal publishes conditions as HTML prose. An empty criteria array
  // would otherwise mean "no conditions", and every applicant would qualify.
  const programme = toProgramme(topic(), 'now')!
  const verdict = await assess(programme, { jurisdiction: 'bg', kind: 'institution' })

  assert.equal(programme.criteria.length, 0)
  assert.equal(verdict.eligible, undefined, 'an unread call was reported as eligible')
  assert.equal(verdict.undecidable.length, 1)
  assert.match(verdict.undecidable[0]!.reason, /prose/)
})

test('the reason points at where the conditions can be read', async () => {
  const verdict = await assess(toProgramme(topic(), 'now')!, { kind: 'institution' })
  assert.match(verdict.undecidable[0]!.reason, /ec\.europa\.eu/)
})

test('the same call in several languages is one programme', async () => {
  // The portal returns a record per language.
  const { fetch } = portal([[topic(), topic(), topic()]])
  const loaded = await loadEuProgrammes({ fetch: fetch as never, pageSize: 50 })

  assert.equal(loaded.length, 1)
})

test('paging stops on a short page rather than asking forever', async () => {
  const { fetch, sent } = portal([
    [topic(), topic({ identifier: ['B'] })],
    [topic({ identifier: ['C'] })],
  ])

  const loaded = await loadEuProgrammes({ fetch: fetch as never, pageSize: 2 })

  assert.equal(sent.length, 2)
  assert.equal(loaded.length, 3)
})

test('reaching the page ceiling throws rather than returning a short catalogue', async () => {
  const full = () => [topic({ identifier: [String(Math.random())] })]
  const { fetch } = portal([full(), full(), full(), full()])

  await assert.rejects(
    () => loadEuProgrammes({ fetch: fetch as never, maxPages: 2, pageSize: 1 }),
    /partial catalogue/,
  )
})

test('an error from the portal names the likely cause', async () => {
  const fetch = async () => new Response('boom', { status: 500 })

  await assert.rejects(
    () => loadEuProgrammes({ fetch: fetch as never }),
    /Content-Type: application\/json/,
  )
})

// THE PORTAL PUBLISHES ONE RECORD PER LANGUAGE, interleaved. Taking the first
// of each id gives whichever the API felt like — a live load of 703 programmes
// came back with Bulgarian titles in a catalogue asked for in English.

const inLanguage = (language: string, title: string) =>
  topic({ language: [language], title: [title] })

test('the asked-for language wins, whatever arrived first', async () => {
  const { fetch } = portal([[inLanguage('bg', 'Управление на околната среда'), inLanguage('en', 'Environment governance')]])
  const [loaded] = await loadEuProgrammes({ fetch: fetch as never, pageSize: 50 })

  assert.equal(loaded!.name, 'Environment governance')
})

test('it wins even when it arrives second, across pages', async () => {
  const { fetch } = portal([
    [inLanguage('bg', 'Управление на околната среда'), topic({ identifier: ['OTHER'] })],
    [inLanguage('en', 'Environment governance')],
  ])
  const loaded = await loadEuProgrammes({ fetch: fetch as never, pageSize: 2 })

  assert.equal(loaded.find((p) => p.id === 'EU4H-2024-PJ-02-3')!.name, 'Environment governance')
})

test('a call published in no English version is kept, not dropped', async () => {
  // Missing from the catalogue is worse than present in another language: a
  // school cannot apply for what it was never shown.
  const { fetch } = portal([[inLanguage('bg', 'Управление на околната среда')]])
  const loaded = await loadEuProgrammes({ fetch: fetch as never, pageSize: 50 })

  assert.equal(loaded.length, 1)
  assert.equal(loaded[0]!.name, 'Управление на околната среда')
})

test('another language can be asked for', async () => {
  const { fetch } = portal([[inLanguage('en', 'Environment governance'), inLanguage('bg', 'Управление на околната среда')]])
  const [loaded] = await loadEuProgrammes({ fetch: fetch as never, language: 'bg', pageSize: 50 })

  assert.equal(loaded!.name, 'Управление на околната среда')
})
