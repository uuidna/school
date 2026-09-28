import type { Payload } from 'payload'

/**
 * A Payload stood up in memory, for testing a host against this package.
 *
 * SIXTEEN TEST FILES BUILT ONE OF THESE BY HAND, and six repeated the same
 * tenant stanza verbatim — `docs: [{ domain: 'school.bg', id: 1 }]` — because
 * every tool resolves a tenant before it reads anything, so every test needs
 * that branch and each one wrote it again. Six copies of one fact is six places
 * to update when tenancy changes, and five of them will be missed.
 *
 * IT IS SHIPPED RATHER THAN HIDDEN IN THE TESTS. This package defines no
 * collections; the host does, and `assertSchema` refuses a host whose schema
 * cannot carry what the package promises. A host that must satisfy a guard
 * ought to be able to exercise it without standing up a database, which is
 * exactly what this is for.
 *
 * WHAT IT IS NOT: a Payload. It answers the handful of calls this package
 * makes — find, count, create, update, findVersions — and nothing else. A test
 * that needs more than that is testing Payload, and should use Payload.
 */

export type FakeCall = {
  collection: string
  data?: Record<string, unknown>
  id?: unknown
  op: 'create' | 'update'
}

export type FakePayloadOptions = {
  /** Rows per collection. Anything unnamed answers empty. */
  docs?: Record<string, Record<string, unknown>[]>
  /** Totals per collection for `count`. Defaults to the row count. */
  counts?: Record<string, number>
  /**
   * The school this host serves. One by default, because a deployment holding
   * more than one refuses to read anything unscoped — which is correct, and is
   * not what most tests are about.
   */
  tenants?: Record<string, unknown>[]
  /** Version rows for `findVersions`. The access trail is version history. */
  versions?: Record<string, unknown>[]
  /**
   * Collections as the Lexical editor needs to see them. Only markdown-writing
   * tools reach for this; the editor's link and upload features read `admin`
   * off every collection and fail inside the editor without it.
   */
  editorCollections?: string[]
}

const SCHOOL = [{ domain: 'school.bg', id: 1 }]

export type FakePayload = {
  calls: FakeCall[]
  payload: Payload
}

/** A Payload that answers from the rows given, and records what was written. */
export const fakePayload = (options: FakePayloadOptions = {}): FakePayload => {
  const calls: FakeCall[] = []
  const docsOf = (collection: string): Record<string, unknown>[] =>
    collection === 'tenants' ? (options.tenants ?? SCHOOL) : (options.docs?.[collection] ?? [])

  const payload = {
    config: {
      collections: (options.editorCollections ?? ['media', 'pages', 'posts']).map((slug) => ({
        admin: { enableRichTextLink: false, enableRichTextRelationship: false },
        fields: [],
        slug,
        ...(slug === 'media' ? { upload: true } : {}),
      })),
    },
    count: async ({ collection }: { collection: string }) => ({
      // TENANTS ANSWER 1 UNLESS ASKED OTHERWISE. A fake that returned the row
      // count for every collection made tenant resolution see five hundred
      // schools and refuse to read users unscoped — the guard was right and the
      // harness was wrong, which is the usual order.
      totalDocs: options.counts?.[collection] ?? docsOf(collection).length,
    }),
    create: async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => {
      calls.push({ collection, data, op: 'create' })
      return { id: 1, ...data }
    },
    find: async ({ collection }: { collection: string }) => {
      const docs = docsOf(collection)
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
    findVersions: async () => {
      const docs = options.versions ?? []
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
    update: async ({ collection, data, id }: { collection: string; data: Record<string, unknown>; id: unknown }) => {
      calls.push({ collection, data, id, op: 'update' })
      return { id, ...data }
    },
  } as unknown as Payload

  return { calls, payload }
}

/** The request shape every tool receives — a host header and a payload. */
export const fakeRequest = (payload: Payload, host = 'school.bg') =>
  ({ headers: new Headers({ host }), payload }) as unknown as Parameters<
    (req: { headers: Headers; payload: Payload }) => void
  >[0]
