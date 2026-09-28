/**
 * The transport under the Microsoft 365 adapter.
 *
 * Graph pages differently from Google, and the difference is not cosmetic.
 * Google returns a `pageToken` you add to the next request; Graph returns
 * `@odata.nextLink`, a **complete URL** that must be requested as given. Its
 * own documentation is explicit that the `$skiptoken` inside must not be
 * extracted and reused elsewhere, because the link encodes the rest of the
 * original query too. Treating it like a token is the mistake that returns
 * page one forever.
 *
 * So this follows links rather than accumulating parameters, and the paging
 * discipline is the same as everywhere else here: to the end, or throw. A
 * partial directory answers "who can see pupils' data" with a guess.
 *
 * Endpoint provenance: `/users` and the paging contract were read from
 * Microsoft's reference. The collection shape — `value` plus
 * `@odata.nextLink` — is documented as general to Graph collections, and the
 * remaining paths follow it. Anything that turns out otherwise is a bug in
 * this file, not in the port.
 */

import { request } from '../transport.js'
import { cachedToken, withFreshToken } from '../token.js'

export type GraphFetch = (url: string, init?: RequestInit) => Promise<Response>

import type { TokenSource } from '../types.js'

export type { TokenSource }

export type GraphOptions = {
  fetch?: GraphFetch
  token: TokenSource
}

export const GRAPH = 'https://graph.microsoft.com/v1.0'

export class GraphError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string, body: string) {
    super(`Microsoft Graph ${status} for ${url}: ${body.slice(0, 400)}`)
    this.name = 'GraphError'
    this.status = status
    this.url = url
  }
}

export class GraphTruncated extends Error {
  constructor(url: string, pages: number) {
    super(
      `Following ${url} exceeded ${pages} pages — refusing to return a partial result, because a short answer that looks complete is worse than an error.`,
    )
    this.name = 'GraphTruncated'
  }
}

const MAX_PAGES = 10_000

/**
 * The permissions each capability needs.
 *
 * Read-only throughout except where a deployment explicitly opts into writing.
 * A package that reads a directory in order to report on it has no business
 * holding a permission that can change it.
 */
export const GRAPH_PERMISSIONS = {
  audit: 'AuditLog.Read.All',
  calendar: 'Calendars.Read',
  documents: 'Files.Read.All',
  groups: 'Group.Read.All',
  people: 'User.Read.All',
  /** Only where role changes go through this package. */
  peopleWrite: 'User.ReadWrite.All',
  /**
   * Classes and their membership.
   *
   * The least-privileged application permission Graph offers for
   * /education/classes/{id}/members; EduRoster.ReadWrite.All would also work
   * and can also change a child's enrolment, which nothing here does.
   */
  rosters: 'EduRoster.Read.All',
} as const

export const permissionsFor = (options: {
  calendar?: boolean
  documents?: boolean
  groups?: boolean
  rosters?: boolean
  writablePeople?: boolean
}): string[] => {
  const needed: string[] = [GRAPH_PERMISSIONS.people, GRAPH_PERMISSIONS.audit]

  if (options.groups) needed.push(GRAPH_PERMISSIONS.groups)
  if (options.calendar) needed.push(GRAPH_PERMISSIONS.calendar)
  if (options.documents) needed.push(GRAPH_PERMISSIONS.documents)
  if (options.rosters) needed.push(GRAPH_PERMISSIONS.rosters)
  if (options.writablePeople) needed[0] = GRAPH_PERMISSIONS.peopleWrite

  return [...new Set(needed)]
}

export const graphApi = ({ fetch: doFetch, token }: GraphOptions) => {
  // A Graph access token is a JWT and says when it dies, so this believes it
  // rather than assuming a lifetime — and renews a minute early, so a request
  // in flight does not cross the line. See source/token.ts.
  const held = cachedToken(token)

  const call = async <T>(url: string, init?: RequestInit): Promise<T> => {
    // THROUGH THE SHARED TRANSPORT — retry, backoff, Retry-After and a deadline
    // in one place rather than two copies free to disagree. Graph throttles
    // with 429 and a Retry-After it means, which this obeys in preference to
    // any curve computed here. See source/transport.ts.
    const response = await withFreshToken(held, (bearer) =>
      request(
        url,
        {
          ...init,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${bearer}`,
            ...(init?.headers as Record<string, string> | undefined),
          },
        },
        doFetch ? { fetch: doFetch } : {},
      ),
    )

    if (!response.ok) {
      throw new GraphError(response.status, url, await response.text().catch(() => ''))
    }

    return (await response.json()) as T
  }

  /**
   * Every page, by following the link Graph gives rather than rebuilding a
   * query. The link carries the original request's parameters with it.
   */
  const listAll = async <Item>(url: string): Promise<Item[]> => {
    const all: Item[] = []
    let next: string | undefined = url

    for (let page = 0; page < MAX_PAGES; page++) {
      const body: { '@odata.nextLink'?: string; value?: Item[] } = await call(next!)
      all.push(...(body.value ?? []))

      next = body['@odata.nextLink']
      if (!next) return all
    }

    throw new GraphTruncated(url, MAX_PAGES)
  }

  return { call, listAll }
}
