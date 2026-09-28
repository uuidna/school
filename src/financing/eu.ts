import { sealProgramme } from './provenance.js'
import type { FinancingProgramme } from './types.js'

/**
 * The EU Funding & Tenders Portal, as a source of programmes.
 *
 * The Commission publishes calls through the SEDIA search API. What follows
 * was established by calling it, because the documentation describes it and
 * the descriptions are not enough to make a request that works:
 *
 * - `POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA`
 * - `text` is required as a query-string parameter; `***` matches everything.
 * - the query goes in a **multipart** part named `query` that must carry
 *   `Content-Type: application/json`. Sent as a urlencoded field, or as a
 *   multipart part with the default content type, the filter is silently
 *   ignored — the call returns 200 and every one of 4.2 million records. That
 *   silence is the dangerous part: it looks like a working integration
 *   returning a great many results.
 * - reference codes come from the sibling `facet` endpoint. `type` 1 is Grant
 *   and 2 Calls for proposals; `status` 31094501 is Forthcoming and 31094502
 *   Open for submission.
 *
 * **What this loader will not do is invent eligibility.** A topic's conditions
 * arrive as a block of HTML prose, so no criterion can be derived from them.
 * Each programme is therefore marked `conditionsUnparsed`, which the engine
 * treats as undecidable rather than as an absence of conditions — an applicant
 * told they qualify for something nobody read is exactly the harm the
 * provenance rule exists to prevent.
 */

const SEARCH = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search'
const API_KEY = 'SEDIA'

/** Reference codes, as the facet endpoint reports them. */
export const EU_TYPE = { call: '2', cascade: '8', grant: '1', tender: '0' } as const
export const EU_STATUS = { closed: '31094503', forthcoming: '31094501', open: '31094502' } as const

export type EuFetch = (url: string, init?: RequestInit) => Promise<Response>

export type EuLoaderOptions = {
  fetch?: EuFetch
  /** Rows per request. The portal caps this; 50 is comfortable. */
  pageSize?: number
  /** Stop after this many pages. Reaching it throws rather than truncating. */
  maxPages?: number
  /** Which record types to take. Defaults to grants and calls for proposals. */
  types?: string[]
  /**
   * Which language to take a call's title in.
   *
   * The portal publishes one record per language and they arrive interleaved,
   * so taking the first of each id gives whichever the API happened to return
   * first — a live load came back with Bulgarian titles in an English
   * catalogue. Defaults to English; anything not published in the asked-for
   * language falls back to the first seen rather than being dropped.
   */
  language?: string
  /** Which statuses. Defaults to forthcoming and open — not closed. */
  statuses?: string[]
  /**
   * Extra clauses ANDed with the type and status filters — a programme family,
   * a call identifier, a framework. A school tracking Erasmus+ has no use for
   * every open call in the Union, and paging 300 times to discard them is not
   * a narrower question, only a slower one.
   */
  must?: unknown[]
}

type SearchResult = {
  metadata?: Record<string, string[] | undefined>
  reference?: string
  url?: string
}

const first = (value: string[] | undefined): string | undefined => {
  const entry = value?.[0]
  return typeof entry === 'string' && entry.trim() ? entry.trim() : undefined
}

/** ISO date, or nothing. The portal sometimes carries an unparseable value. */
const isoDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString()
}

/**
 * One portal record as a programme.
 *
 * Only fields the portal actually publishes as data are carried across.
 * `authority` is the Commission because that is who publishes this API; the
 * programme's own division arrives as a numeric code, so it is kept as a
 * traceable attribute rather than guessed into a name.
 */
export const toProgramme = (
  result: SearchResult,
  fetchedAt: string,
): FinancingProgramme | undefined => {
  const md = result.metadata ?? {}
  const id = first(md.identifier) ?? first(md.callIdentifier) ?? result.reference
  const name = first(md.title) ?? first(md.callTitle)

  if (!id || !name) return undefined

  const url = first(md.url) ?? result.url
  const opens = isoDate(first(md.startDate))
  const closes = isoDate(first(md.deadlineDate))

  // "single-stage" / "two-stage": the authority's own words for its process.
  const model = first(md.deadlineModel)

  return {
    authority: 'European Commission',
    conditionsUnparsed: {
      reason:
        'the portal publishes this call’s eligibility as prose, so no condition here has been checked against the applicant',
      ...(url ? { url } : {}),
    },
    // Deliberately empty: see conditionsUnparsed.
    criteria: [],
    id,
    name,
    provenance: {
      api: 'eu:funding-tenders',
      fetchedAt,
      ...(first(md.callIdentifier) ? { reference: first(md.callIdentifier)! } : {}),
      ...(url ? { url } : {}),
    },
    ...(model ? { workflow: model === 'two-stage' ? ['stage 1', 'stage 2'] : [model] } : {}),
    ...(opens || closes
      ? { window: { ...(closes ? { closes } : {}), ...(opens ? { opens } : {}) } }
      : {}),
  }
}

export class EuPortalError extends Error {
  constructor(status: number, body: string) {
    super(
      `EU Funding & Tenders portal returned ${status}: ${body.slice(0, 300)}. ` +
        `A 500 here usually means the query part was sent without Content-Type: application/json.`,
    )
    this.name = 'EuPortalError'
  }
}

/** Reaching the page ceiling throws rather than returning a short catalogue. */
export class EuTruncated extends Error {
  constructor(pages: number) {
    super(
      `Stopped after ${pages} pages of the EU portal — refusing to return a partial catalogue, because a school shown fewer options than exist cannot tell that from having fewer options.`,
    )
    this.name = 'EuTruncated'
  }
}

/**
 * Builds the multipart body by hand.
 *
 * The part's content type is the whole point and is the one thing a form
 * helper will not let you set reliably, so the body is assembled here where it
 * is visible.
 */
export const queryBody = (query: unknown, boundary: string): string =>
  [
    `--${boundary}`,
    'Content-Disposition: form-data; name="query"',
    'Content-Type: application/json',
    '',
    JSON.stringify(query),
    `--${boundary}--`,
    '',
  ].join('\r\n')

/**
 * Every open and forthcoming call, paged to the end.
 *
 * Programmes come back with provenance and without criteria. Nothing here
 * decides whether a school qualifies; it decides what exists to be read.
 */
export async function loadEuProgrammes(
  options: EuLoaderOptions = {},
): Promise<FinancingProgramme[]> {
  const {
    fetch: doFetch = globalThis.fetch,
    language = 'en',
    maxPages = 200,
    pageSize = 50,
    must = [],
    statuses = [EU_STATUS.forthcoming, EU_STATUS.open],
    types = [EU_TYPE.grant, EU_TYPE.call],
  } = options

  if (!doFetch) throw new Error('No fetch available to reach the EU portal')

  const fetchedAt = new Date().toISOString()
  const query = {
    bool: { must: [{ terms: { type: types } }, { terms: { status: statuses } }, ...must] },
  }

  const programmes = new Map<string, FinancingProgramme>()
  /** Whether the held record is the asked-for language. */
  const heldLanguages = new Map<string, boolean>()
  /**
   * Every closing date the portal published for each id, across languages.
   *
   * The rows are not always the same record in different words: one topic in
   * four calls came back with two different deadlines eighteen hours apart,
   * depending on which language row was read. Keeping whichever language was
   * asked for records one of them silently, so all of them are collected and
   * the disagreement travels with the programme.
   */
  const deadlines = new Map<string, Set<string>>()

  for (let page = 1; page <= maxPages; page++) {
    const boundary = `----uuidna${page}`
    const url = `${SEARCH}?apiKey=${API_KEY}&text=***&pageSize=${pageSize}&pageNumber=${page}`

    const response = await doFetch(url, {
      body: queryBody(query, boundary),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
    })

    if (!response.ok) throw new EuPortalError(response.status, await response.text().catch(() => ''))

    const body = (await response.json()) as { results?: SearchResult[]; totalResults?: number }
    const results = body.results ?? []

    for (const result of results) {
      const programme = toProgramme(result, fetchedAt)
      if (!programme) continue

      if (programme.window?.closes) {
        const seen = deadlines.get(programme.id) ?? new Set<string>()
        seen.add(programme.window.closes)
        deadlines.set(programme.id, seen)
      }

      const inAskedLanguage = first(result.metadata?.language) === language
      const held = programmes.get(programme.id)

      // Keep the asked-for language when it appears, whatever arrived first;
      // otherwise hold what there is, so a call published in no English
      // version is still in the catalogue rather than missing from it.
      if (!held || (inAskedLanguage && !heldLanguages.get(programme.id))) {
        programmes.set(programme.id, programme)
        heldLanguages.set(programme.id, inAskedLanguage)
      }
    }

    // Sealed on the way out rather than at each construction site: the
    // address covers the record as it finally stands, after the
    // language-preference replacement above has settled which copy is held.
    if (results.length < pageSize) return Promise.all([...programmes.values()].map(withDispute).map(sealProgramme))
  }

  throw new EuTruncated(maxPages)

  /** The held record, plus every other window the portal published for it. */
  function withDispute(programme: FinancingProgramme): FinancingProgramme {
    const seen = deadlines.get(programme.id)
    if (!seen || seen.size < 2) return programme
    return { ...programme, windowDisputed: { closes: [...seen].sort() } }
  }
}
