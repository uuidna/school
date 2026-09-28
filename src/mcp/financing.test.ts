import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { financingMcpTools } from './financing.js'

// THE RESEARCHER TOOL MUST NOT TOUCH A RECORD OF A PERSON. uuidna is for
// researchers whatever their age, so a pupil has to be able to ask — and the
// only way that belongs on a surface which deliberately excludes pupils'
// records is if the applicant's details come from the call and go nowhere.
// These tests watch every collection the tools read.

const tool = (name: string) => financingMcpTools.find((entry) => entry.name === name)!

const PROGRAMMES = [
  {
    authority: 'European Commission',
    criteria: [
      { criterionId: 'place', describe: 'established in Bulgaria', field: 'jurisdiction', op: 'eq', value: 'bg' },
    ],
    name: 'Erasmus-like',
    programmeId: 'good',
    provenance: { api: 'eu:funding-tenders', fetchedAt: '2026-09-01T00:00:00.000Z' },
  },
  {
    authority: 'Somebody',
    criteria: [],
    name: 'Invented',
    programmeId: 'no-provenance',
    // No provenance at all: must never be evaluated.
    provenance: {},
  },
]

/** A catalogue as the collection stores it. */
const CATALOGUE = {
  approvedBy: {
    act: 'РМС № 278 от 09.04.2026 г.',
    date: '2026-04-09',
    url: 'https://www.mon.bg/',
  },
  authority: 'Министерство на образованието и науката',
  id: 1,
  jurisdiction: 'bg',
  programmes: [
    { name: 'НП „Ученически олимпиади и състезания“', programmeId: 'np-2026-02' },
    { name: 'НП „ИКТ в системата на образованието“', programmeId: 'np-2026-05' },
  ],
  year: 2026,
}

const run = async (
  name: string,
  args: Record<string, unknown> = {},
  rows: Record<string, unknown>[] = PROGRAMMES,
  catalogues: Record<string, unknown>[] = [],
) => {
  const read: string[] = []
  const written: Record<string, unknown>[] = []
  const payload = {
    count: async () => ({ totalDocs: 1 }),
    create: async (a: Record<string, unknown>) => { written.push(a); return { id: 9 } },
    find: async (a: { collection: string }) => {
      read.push(a.collection)
      if (a.collection === 'tenants') {
        return { docs: [{ id: 1, domain: 'school.bg', jurisdiction: 'bg' }], hasNextPage: false, totalDocs: 1 }
      }
      const docs =
        a.collection === 'financing-programmes'
          ? rows
          : a.collection === 'national-catalogues'
            ? catalogues
            : []
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
    update: async (a: Record<string, unknown>) => { written.push(a); return { id: 1 } },
  }
  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  const out = await tool(name).handler(args, req)
  const text = out.content[0]!.text
  // failure() returns a plain sentence, not JSON. Parsing blindly would turn
  // every refusal into a harness crash instead of the refusal under test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = {}
  try {
    result = JSON.parse(text)
  } catch {
    result = {}
  }
  return { isError: out.isError, read, result, text, written }
}

test('a programme with no provenance is excluded and the exclusion is reported', async () => {
  // Silently dropping it would show a school fewer options than it has.
  const { result } = await run('school_financing_opportunities')

  assert.equal(result.assessed.length, 1)
  assert.equal(result.excluded, 1)
  assert.match(result.excludedReason, /provenance/)
})

test('the school is assessed from its own record, and the law is named', async () => {
  const { result } = await run('school_financing_opportunities')

  assert.equal(result.applicant.kind, 'institution')
  assert.equal(result.applicant.jurisdiction, 'bg')
  assert.equal(result.jurisdiction.code, 'bg')
  assert.ok(['tenant', 'environment', 'default'].includes(result.jurisdiction.source))
})

test('undecidable programmes are counted apart from eligible and ineligible', async () => {
  const undecidable = [
    {
      authority: 'EC',
      criteria: [
        { criterionId: 'size', describe: 'at least 100 pupils', field: 'pupilCount', op: 'gte', value: 100 },
      ],
      name: 'Sized',
      programmeId: 'sized',
      provenance: { api: 'eu:funding-tenders', fetchedAt: '2026-09-01T00:00:00.000Z' },
    },
  ]
  const { result } = await run('school_financing_opportunities', {}, undecidable)

  assert.equal(result.summary.undecided, 1)
  assert.equal(result.summary.ineligible, 0)
  assert.match(result.assessed[0].undecidable[0], /has not stated pupilCount/)
})

test('the researcher tool reads the catalogue and no record of any person', async () => {
  const { read } = await run('school_researcher_financing', { isMinor: 'yes' })

  assert.ok(read.includes('financing-programmes'))
  for (const collection of ['users', 'students', 'access-log', 'documents']) {
    assert.ok(!read.includes(collection), `it read ${collection}`)
  }
})

test('the researcher tool writes nothing', async () => {
  assert.equal(tool('school_researcher_financing').writes, false)
  assert.equal(tool('school_financing_opportunities').writes, false)
  assert.equal(tool('school_financing_plan').writes, false)
})

test('a pupil and a parent may ask; a pupil may not ask about the school', async () => {
  assert.ok(tool('school_researcher_financing').allowedRoles.includes('student'))
  assert.ok(tool('school_researcher_financing').allowedRoles.includes('parent'))

  assert.ok(!tool('school_financing_opportunities').allowedRoles.includes('student'))
  assert.ok(!tool('school_financing_plan').allowedRoles.includes('parent'))
})

test('a minor with no established consent is undecided, not refused', async () => {
  const { result } = await run('school_researcher_financing', { isMinor: 'yes' })

  assert.equal(result.assessed[0].eligible, undefined)
  assert.equal(result.assessed[0].guardianship.satisfied, undefined)
})

test('a minor with stated consent is assessed on the programme itself', async () => {
  const { result } = await run('school_researcher_financing', {
    guardianConsentAt: '2026-09-01',
    guardianConsentBy: '12a@parents.school.bg',
    isMinor: 'yes',
  })

  assert.equal(result.assessed[0].guardianship.satisfied, true)
  assert.equal(result.assessed[0].eligible, true)
})

test('a half-stated consent is not a consent', async () => {
  // A date with no evidence, or evidence with no date, must not become a record
  // that a guardian agreed.
  const { result } = await run('school_researcher_financing', {
    guardianConsentAt: '2026-09-01',
    isMinor: 'yes',
  })

  assert.equal(result.assessed[0].guardianship.satisfied, undefined)
})

test('an applicant who does not say whether they are a minor is undecided', async () => {
  const { result } = await run('school_researcher_financing', {})

  assert.equal(result.assessed[0].guardianship.satisfied, undefined)
  assert.match(result.assessed[0].guardianship.reason, /state isMinor/)
})

test('an adult researcher is assessed without a guardian', async () => {
  const { result } = await run('school_researcher_financing', { isMinor: 'no' })

  assert.equal(result.assessed[0].guardianship.required, false)
  assert.equal(result.assessed[0].eligible, true)
})

test('the answer states that nothing about the applicant was stored', async () => {
  const { result } = await run('school_researcher_financing', { isMinor: 'yes' })

  assert.match(result.privacy, /neither|nothing about the applicant/i)
})

test('the plan refuses a programme that is not usable, and says why it might not be', async () => {
  const { result: _r } = await run('school_financing_opportunities')
  const payload = {
    count: async () => ({ totalDocs: 1 }),
    find: async (a: { collection: string }) => {
      if (a.collection === 'tenants') {
        return { docs: [{ id: 1, domain: 'school.bg' }], hasNextPage: false, totalDocs: 1 }
      }
      const docs = a.collection === 'financing-programmes' ? PROGRAMMES : []
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
  }
  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest

  const refused = await tool('school_financing_plan').handler({ programmeId: 'no-provenance' }, req)

  assert.equal(refused.isError, true)
  assert.match(refused.content[0]!.text, /provenance/)
})

// NATIONAL PROGRAMMES ARE NOT PUBLISHED AS DATA, so they are declared — and a
// declaration is only worth anything if the act behind it is named and its age
// is visible. These tests are mostly about the second part, because a stale
// catalogue is the failure that looks exactly like a current one.

test('a jurisdiction with no recorded catalogue is told so, not shown nothing', async () => {
  const { result } = await run('school_national_programmes', {}, PROGRAMMES, [])

  assert.deepEqual(result.programmes, [])
  assert.match(result.note, /No national programme catalogue/)
  assert.match(result.note, /school_record_national_catalogue/)
})

test('the recorded catalogue is loaded with its act', async () => {
  const { result } = await run('school_national_programmes', {}, PROGRAMMES, [CATALOGUE])

  assert.equal(result.programmes.length, 2)
  assert.equal(result.approvedBy.act, 'РМС № 278 от 09.04.2026 г.')
  assert.equal(result.year, 2026)
})

test('no national programme is ever reported eligible from its name alone', async () => {
  const { result } = await run('school_national_programmes', {}, PROGRAMMES, [CATALOGUE])

  for (const p of result.programmes) {
    assert.equal(p.eligible, undefined, `${p.programme.id} was claimed eligible`)
    assert.match(p.undecidable[0], /prose/)
  }
})

test('staleness is computed at read time, not frozen when recorded', async () => {
  // A 2024 catalogue read now: the act has almost certainly been superseded.
  const old = { ...CATALOGUE, year: 2024 }
  const { result } = await run('school_national_programmes', {}, PROGRAMMES, [old])

  assert.equal(result.staleness.stale, true)
  assert.ok(result.staleness.behind >= 1)
  assert.match(result.programmes[0].undecidable[0], /revised annually|superseded/)
})

test('a catalogue the loader refuses is reported, not silently skipped', async () => {
  // A school shown no national programmes cannot tell that from there being none.
  const broken = { ...CATALOGUE, approvedBy: { act: '', date: '' } }
  const { isError, text } = await run('school_national_programmes', {}, PROGRAMMES, [broken])

  assert.equal(isError, true)
  assert.match(text, /cannot be used/)
})

test('recording a catalogue without an act is refused before it reaches the database', async () => {
  const { isError, text, written } = await run(
    'school_record_national_catalogue',
    { act: '  ', actDate: '2026-04-09', authority: 'МОН', programmes: [{ id: 'a', name: 'b' }], year: '2026' },
    PROGRAMMES,
    [],
  )

  assert.equal(isError, true)
  assert.match(text, /no approving act/)
  assert.deepEqual(written, [], 'a catalogue that cannot be loaded was stored anyway')
})

test('recording a catalogue with no programmes is refused', async () => {
  const { isError, written } = await run(
    'school_record_national_catalogue',
    { act: 'РМС № 1', actDate: '2026-04-09', authority: 'МОН', programmes: [], year: '2026' },
    PROGRAMMES,
    [],
  )

  assert.equal(isError, true)
  assert.deepEqual(written, [])
})

test('a year that is not a year is refused', async () => {
  const { isError } = await run(
    'school_record_national_catalogue',
    { act: 'РМС № 1', actDate: '2026-04-09', authority: 'МОН', programmes: [{ id: 'a', name: 'b' }], year: 'last' },
    PROGRAMMES,
    [],
  )

  assert.equal(isError, true)
})

test('a good catalogue is written with its act and its programmes', async () => {
  const { result, written } = await run(
    'school_record_national_catalogue',
    {
      act: 'РМС № 278 от 09.04.2026 г.',
      actDate: '2026-04-09',
      authority: 'МОН',
      programmes: [{ id: 'np-1', name: 'НП едно' }],
      year: '2026',
    },
    PROGRAMMES,
    [],
  )

  assert.equal(result.action, 'created')
  assert.equal(result.programmes, 1)
  assert.equal(written.length, 1)
  assert.equal(written[0]!.overrideAccess, false, 'the write skipped access control')
})

test('the combined view includes national programmes and names both sources', async () => {
  // A school asking what it can apply for is not asking about one authority.
  const { result } = await run('school_financing_opportunities', {}, PROGRAMMES, [CATALOGUE])

  assert.equal(result.sources.national.count, 2)
  assert.equal(result.sources.national.act, 'РМС № 278 от 09.04.2026 г.')
  assert.equal(result.sources.recorded.count, 1)
  assert.equal(result.assessed.length, 3)
})

test('the combined view still works where no catalogue was recorded', async () => {
  const { result } = await run('school_financing_opportunities', {}, PROGRAMMES, [])

  assert.equal(result.sources.national.count, 0)
  assert.match(result.sources.national.note, /no national catalogue/)
  assert.equal(result.assessed.length, 1)
})

// THE ROUND TRIP. The loaders mark a programme whose conditions the authority
// publishes as prose, and that marker is the only thing stopping an empty
// criteria list from assessing as eligible for everybody. It travelled as far
// as storage and no further — the collection had no column for it — so an EU
// call read back from the database came out with no conditions, no marker,
// and a verdict of "eligible" on conditions nobody has read.

/** An EU call as the loader produces it and the collection stores it. */
const EU_ROW = {
  authority: 'European Commission',
  closes: '2026-11-04T00:00:00.000Z',
  conditionsUnparsed: {
    reason: 'the portal publishes this call’s eligibility as prose, so no condition here has been checked against the applicant',
    url: 'https://ec.europa.eu/call',
  },
  criteria: [],
  name: 'Nature and Biodiversity',
  programmeId: 'LIFE-2026-SAP-NAT-NATURE',
  provenance: { api: 'eu:funding-tenders', fetchedAt: '2026-09-20T00:00:00.000Z' },
}

test('a call whose conditions nobody has read is never reported eligible', async () => {
  const { result } = await run(
    'school_financing_opportunities',
    { jurisdiction: 'bg', pupils: 300 },
    [EU_ROW],
  )

  const entry = (result.assessed as { eligible?: boolean; undecidable: string[] }[])[0]!

  assert.notEqual(entry.eligible, true, 'a call with unread conditions was reported eligible')

  // And the authority's own reason survives with it, not a generic stand-in.
  // The engine's fallback would keep the verdict right while losing the one
  // thing an applicant can act on: where to go and read them.
  const said = entry.undecidable.join(' ')
  assert.match(said, /publishes this call’s eligibility as prose/)
  assert.match(said, /read them at https:\/\/ec\.europa\.eu\/call/)
})

test('and it is still not eligible when the marker is missing entirely', async () => {
  // The part that does not depend on a storage path remembering. Silence
  // about conditions is undecidable wherever the record came from.
  const { conditionsUnparsed: _lost, ...stripped } = EU_ROW

  const { result } = await run(
    'school_financing_opportunities',
    { jurisdiction: 'bg', pupils: 300 },
    [stripped],
  )

  const entry = (result.assessed as { eligible?: boolean; undecidable: string[] }[])[0]!

  assert.notEqual(entry.eligible, true)
  assert.match(entry.undecidable.join(' '), /not the same as the authority publishing none/)
})
