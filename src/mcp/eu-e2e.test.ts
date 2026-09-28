import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { financingMcpTools } from './financing.js'

// END TO END, FROM THE COMMISSION'S OWN BYTES TO A ROW THE ENGINE READS.
//
// loadEuProgrammes was exported, tested and verified against the live portal,
// and NOTHING connected it to `financing-programmes` — the collection every
// financing answer is computed from. A school's catalogue could only be typed
// in by hand. The loader was reachable and unfused: wired at one end with
// nothing at the other, which is the defect this package keeps finding.
//
// The fixture below is a RECORDED LIVE RESPONSE, trimmed to three of the
// twenty-four language rows the portal actually returned for one call
// identifier on 2026-09-20. Three, because the interesting part is that the
// portal returns the same topic once per language and the loader has to end
// with one programme, not twenty-four.

const PORTAL_RESPONSE = {
  "results": [
    {
      "reference": "45749859HORIZONTMAMSCADoctoralNetworks1716940800000cs",
      "url": "https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/HORIZON-MSCA-2024-DN-01-01.json",
      "metadata": {
        "callIdentifier": [
          "HORIZON-MSCA-2024-DN-01"
        ],
        "deadlineDate": [
          "2024-11-26T23:00:00.000+0000"
        ],
        "deadlineModel": [
          "single-stage"
        ],
        "identifier": [
          "HORIZON-MSCA-2024-DN-01-01"
        ],
        "language": [
          "cs"
        ],
        "startDate": [
          "2024-05-28T22:00:00.000+0000"
        ],
        "title": [
          "MSCA Doctoral Networks 2024"
        ]
      }
    },
    {
      "reference": "45749859HORIZONTMAMSCADoctoralNetworks1716940800000",
      "url": "https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/HORIZON-MSCA-2024-DN-01-01.json",
      "metadata": {
        "callIdentifier": [
          "HORIZON-MSCA-2024-DN-01"
        ],
        "deadlineDate": [
          "2024-11-27T17:00:00.000+0000"
        ],
        "deadlineModel": [
          "single-stage"
        ],
        "identifier": [
          "HORIZON-MSCA-2024-DN-01-01"
        ],
        "language": [
          "en"
        ],
        "startDate": [
          "2024-05-29T00:00:00.000+0000"
        ],
        "title": [
          "MSCA Doctoral Networks 2024"
        ]
      }
    },
    {
      "reference": "45749859HORIZONTMAMSCADoctoralNetworks1716940800000bg",
      "url": "https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/HORIZON-MSCA-2024-DN-01-01.json",
      "metadata": {
        "callIdentifier": [
          "HORIZON-MSCA-2024-DN-01"
        ],
        "deadlineDate": [
          "2024-11-26T23:00:00.000+0000"
        ],
        "deadlineModel": [
          "single-stage"
        ],
        "identifier": [
          "HORIZON-MSCA-2024-DN-01-01"
        ],
        "language": [
          "bg"
        ],
        "startDate": [
          "2024-05-28T22:00:00.000+0000"
        ],
        "title": [
          "MSCA Doctoral Networks 2024"
        ]
      }
    }
  ],
  "totalResults": 3
}

const harness = ({ empty = false }: { empty?: boolean } = {}) => {
  const rows: Record<string, unknown>[] = []
  const asked: string[] = []

  /**
   * The transport, swapped on the global.
   *
   * The tool calls loadEuProgrammes without a fetch, so the loader falls back
   * to globalThis.fetch — which means an e2e written the obvious way reaches
   * the live portal: slow, flaky, and a suite that fails when the Commission
   * is down. Injecting a transport through the tool's arguments would be
   * worse: a production tool taking its network from its caller. So the
   * global is replaced for the duration and restored after.
   */
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url))
    // Page two is empty, which is how the loader knows to stop. `empty`
    // serves what the portal sends for an identifier it does not know: 200,
    // no results, no error.
    return Response.json(!empty && asked.length === 1 ? PORTAL_RESPONSE : { results: [], totalResults: 0 })
  }) as typeof globalThis.fetch
  const restore = () => {
    globalThis.fetch = real
  }

  const payload = {
    count: async () => ({ totalDocs: 1 }),
    create: async (args: { data: Record<string, unknown> }) => {
      rows.push(args.data)
      return { id: rows.length }
    },
    find: async (args: { collection: string; where?: { programmeId?: { equals?: string } } }) => {
      if (args.collection === 'tenants') {
        return { docs: [{ domain: 'school.bg', id: 1, jurisdiction: 'bg' }], hasNextPage: false, totalDocs: 1 }
      }
      const wanted = args.where?.programmeId?.equals
      const found = rows.filter((row) => row.programmeId === wanted)
      return { docs: found, hasNextPage: false, totalDocs: found.length }
    },
    update: async (args: { data: Record<string, unknown> }) => {
      rows[rows.length - 1] = args.data
      return { id: 1 }
    },
  }

  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  return { asked, req, restore, rows }
}

const tool = (name: string) => financingMcpTools.find((entry) => entry.name === name)!

test('a real portal response becomes rows the engine can read', async () => {
  const { req, restore, rows } = harness()

  const result = await tool('school_load_eu_programmes').handler(
    { callIdentifier: 'HORIZON-MSCA-2024-DN-01' },
    req,
  )
  const body = JSON.parse(result.content[0]!.text) as { found: number; recorded: number }

  // Twenty-four language rows for one topic; one programme in the catalogue.
  assert.equal(body.recorded, 1)
  assert.equal(rows.length, 1)

  const row = rows[0] as Record<string, unknown>
  assert.equal(row.programmeId, 'HORIZON-MSCA-2024-DN-01-01')
  assert.equal(row.authority, 'European Commission')
  assert.equal((row.provenance as { api: string }).api, 'eu:funding-tenders')

  // The marker that keeps an empty criteria list honest travels with it.
  assert.ok(row.conditionsUnparsed, 'the row arrived without the unparsed-conditions marker')
  assert.deepEqual(row.criteria, [])

  // THE WINDOW, AND THE FACT THAT THE PORTAL PUBLISHED TWO OF THEM.
  //
  // These three rows are the Czech, English and Bulgarian records of ONE
  // topic, recorded live. Two of them say the deadline is 2024-11-26T23:00
  // and one says 2024-11-27T17:00 — the same call, eighteen hours apart,
  // depending which language you read. The loader keeps the language it was
  // asked for, so it records the English one; what it must not do is record
  // it silently.
  assert.match(String(row.closes), /^2024-11-27/)
  assert.deepEqual((row as { windowDisputed?: { closes: string[] } }).windowDisputed?.closes, [
    '2024-11-26T23:00:00.000Z',
    '2024-11-27T17:00:00.000Z',
  ])

  restore()
})

test('the loaded catalogue is what school_financing_opportunities then reads', async () => {
  // The fusion, end to end: load, then ask. Before this, the second call
  // could only ever answer from rows somebody had typed.
  const { req, restore, rows } = harness()
  await tool('school_load_eu_programmes').handler({ callIdentifier: 'HORIZON-MSCA-2024-DN-01' }, req)

  const reader = {
    ...(req as unknown as { payload: Record<string, unknown> }).payload,
    find: async (args: { collection: string }) =>
      args.collection === 'tenants'
        ? { docs: [{ domain: 'school.bg', id: 1, jurisdiction: 'bg' }], hasNextPage: false, totalDocs: 1 }
        : { docs: args.collection === 'financing-programmes' ? rows : [], hasNextPage: false, totalDocs: rows.length },
  }
  const asking = {
    headers: new Headers({ host: 'school.bg' }),
    payload: reader,
  } as unknown as PayloadRequest

  const answer = await tool('school_financing_opportunities').handler({}, asking)
  const assessed = (JSON.parse(answer.content[0]!.text) as { assessed: { eligible?: boolean; programme: { id: string } }[] }).assessed

  assert.equal(assessed.length, 1)
  assert.equal(assessed[0]!.programme.id, 'HORIZON-MSCA-2024-DN-01-01')
  // Never "eligible": nobody has read this call's conditions.
  assert.notEqual(assessed[0]!.eligible, true)

  restore()
})

test('an identifier the portal does not know is a refusal, not an empty catalogue', async () => {
  // Verified against the live portal earlier: an invented identifier is
  // ACCEPTED, filters nothing out and comes back 200 with no results — which
  // reads exactly like a call that has no topics. A school waiting for its
  // catalogue to fill would wait forever, so the tool says which it is.
  const { req, restore } = harness({ empty: true })

  const result = await tool('school_load_eu_programmes').handler(
    { callIdentifier: 'HORIZON-NOT-A-REAL-CALL-2099' },
    req,
  )

  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /returned no programmes/)
  assert.match(result.content[0]!.text, /check the spelling/)

  restore()
})

test('neither a theme nor an identifier is refused before any request is made', async () => {
  const { asked, req, restore } = harness()

  const result = await tool('school_load_eu_programmes').handler({}, req)

  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /Name a callIdentifier or a theme/)
  assert.deepEqual(asked, [], 'the portal was called before the arguments were checked')

  restore()
})
