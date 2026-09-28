/**
 * The transport under the Workspace adapter.
 *
 * Separated so every call this package makes to Google is visible, assertable
 * and paged to exhaustion. `fetch` is injected rather than reached for, which
 * is what lets the tests check the URL, the scopes and the paging behaviour of
 * each operation without a network or a credential.
 *
 * The paging discipline is `findAll`'s, for the same reason: an access review
 * that stops at the first 500 accounts answers "who can see pupils' data" with
 * a guess, and a statutory document sitting on page three is reported missing.
 * Reaching the page ceiling throws rather than returning a short answer.
 */

export type GoogleFetch = (url: string, init?: RequestInit) => Promise<Response>

import type { TokenSource } from '../types.js'

import { request } from '../transport.js'
import { cachedToken, withFreshToken } from '../token.js'

export type { TokenSource }

export type GoogleApiOptions = {
  fetch?: GoogleFetch
  /** Impersonated subject, for domain-wide delegation. */
  subject?: string
  token: TokenSource
}

export class GoogleApiError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string, body: string) {
    super(`Google API ${status} for ${url}: ${body.slice(0, 400)}`)
    this.name = 'GoogleApiError'
    this.status = status
    this.url = url
  }
}

/** Thrown rather than returning a partial list. */
export class TruncatedListing extends Error {
  constructor(url: string, pages: number) {
    super(
      `Listing ${url} exceeded ${pages} pages — refusing to return a partial result, because a short answer that looks complete is worse than an error.`,
    )
    this.name = 'TruncatedListing'
  }
}

const MAX_PAGES = 10_000

export const buildUrl = (base: string, params: Record<string, number | string | undefined>): string => {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export const googleApi = ({ fetch: doFetch, token }: GoogleApiOptions) => {
  // HELD FOR AS LONG AS IT IS GOOD. The source was asked on every request; a
  // thousand-user directory walk asked a thousand times and still had no way to
  // notice the one moment the token lapsed. Google's access token is opaque and
  // says nothing about its own expiry, so it gets a lifetime shorter than the
  // hour Google grants — see source/token.ts.
  const held = cachedToken(token)

  const call = async <T>(url: string): Promise<T> => {
    // THROUGH THE SHARED TRANSPORT, so a throttled page does not fail an audit.
    // Retry, backoff, Retry-After and a deadline live in one place rather than
    // in two copies free to disagree — see source/transport.ts.
    const response = await withFreshToken(held, (bearer) =>
      request(
        url,
        { headers: { accept: 'application/json', authorization: `Bearer ${bearer}` } },
        doFetch ? { fetch: doFetch } : {},
      ),
    )

    if (!response.ok) {
      throw new GoogleApiError(response.status, url, await response.text().catch(() => ''))
    }

    return (await response.json()) as T
  }

  /**
   * Every page, concatenated. `itemsOf` names the response's collection field,
   * which differs per API (`users`, `files`, `items`, `groups`).
   */
  const listAll = async <Item>(
    base: string,
    params: Record<string, number | string | undefined>,
    itemsOf: (page: Record<string, unknown>) => Item[] | undefined,
  ): Promise<Item[]> => {
    const all: Item[] = []
    let pageToken: string | undefined

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await call<Record<string, unknown>>(buildUrl(base, { ...params, pageToken }))
      all.push(...(itemsOf(body) ?? []))

      pageToken = body.nextPageToken as string | undefined
      if (!pageToken) return all
    }

    throw new TruncatedListing(base, MAX_PAGES)
  }

  return { call, listAll }
}

/**
 * The scopes each capability needs.
 *
 * Stated so a deployment can request the narrowest set that supports what it
 * actually uses, and so a missing scope is a named refusal rather than a 403
 * surfacing from somewhere in the middle of an audit.
 *
 * Read-only throughout except where a tool genuinely writes. A package that
 * reads a school's directory in order to report on it has no business holding
 * a scope that can modify it.
 */
export const SCOPES = {
  audit: 'https://www.googleapis.com/auth/admin.reports.audit.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.readonly',
  /** The classes themselves — names and states, no membership. */
  courses: 'https://www.googleapis.com/auth/classroom.courses.readonly',
  documents: 'https://www.googleapis.com/auth/drive.readonly',
  groups: 'https://www.googleapis.com/auth/admin.directory.group.readonly',
  people: 'https://www.googleapis.com/auth/admin.directory.user.readonly',
  /** Only for a deployment that grants role changes through this package. */
  peopleWrite: 'https://www.googleapis.com/auth/admin.directory.user',
  /**
   * Membership as user ids.
   *
   * Classroom offers `classroom.profile.emails` and `classroom.profile.photos`
   * alongside this one, and either would make `courses.students.list` return
   * the children's addresses and faces. Neither is here, and a test asserts
   * that no configuration can add them: the roster this package reads is
   * pseudonymous, so the consent screen a school approves never asks for the
   * data it does not use. Minimisation that a school can see before granting
   * is worth more than minimisation asserted afterwards.
   */
  rosters: 'https://www.googleapis.com/auth/classroom.rosters.readonly',
} as const

/**
 * The narrowest scope set for a given configuration.
 *
 * SCOPES sat here listing what the adapter needs and nothing read it, so it
 * documented an intention rather than answering a question. A deployment that
 * over-requests holds a scope that can modify a school's directory in order to
 * report on it; one that under-requests discovers the gap as a 403 from inside
 * an audit. This computes the set from what is actually configured.
 */
export const scopesFor = (options: {
  calendar?: boolean
  documents?: boolean
  groups?: boolean
  rosters?: boolean
  writablePeople?: boolean
}): string[] => {
  const needed: string[] = [SCOPES.people, SCOPES.audit]

  if (options.groups) needed.push(SCOPES.groups)
  if (options.calendar) needed.push(SCOPES.calendar)
  if (options.documents) needed.push(SCOPES.documents)
  if (options.rosters) needed.push(SCOPES.courses, SCOPES.rosters)
  // Read-only unless the deployment intends role changes, and then the
  // read-only people scope is redundant with the writable one.
  if (options.writablePeople) needed[0] = SCOPES.peopleWrite

  return [...new Set(needed)]
}

export const DIRECTORY = 'https://admin.googleapis.com/admin/directory/v1'
export const REPORTS = 'https://admin.googleapis.com/admin/reports/v1'
export const DRIVE = 'https://www.googleapis.com/drive/v3'
export const CALENDAR = 'https://www.googleapis.com/calendar/v3'
export const CLASSROOM = 'https://classroom.googleapis.com/v1'
