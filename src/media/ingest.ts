import type { PayloadRequest } from 'payload'

import { sha256Bytes } from '../fair/hash.js'
import { tenantOf } from '../payload/scope.js'

/**
 * Bringing a migration's images into the school's own media library.
 *
 * **Nothing here fetches anything.** The first design took URLs and pulled
 * them server-side behind a host allowlist, which is the ordinary way to do
 * this and is a fence around a hole rather than the absence of one. A server
 * that retrieves an address a caller handed it can be pointed at a cloud
 * metadata endpoint, at a service on its own loopback, at anything a redirect
 * leads to — and the allowlist that holds that back is a table somebody edits
 * every time a school migrates from a different site, widening by accretion,
 * each edit a chance to widen it wrongly.
 *
 * So the caller sends the bytes. There is no list to maintain, no redirect to
 * chase, no window between a hostname passing the check and resolving
 * somewhere else, and it works for any source site without an edit. The thing
 * doing the migration already has the bytes; it is reading those pages anyway.
 *
 * Duplication is impossible rather than unlikely, because the key is a hash of
 * the bytes — and a real migration showed the obvious alternative is wrong in
 * both directions. Across 418 accepted addresses from one CDN, 11 were genuine
 * duplicates: not the `~mv2` suffix variants anybody would predict, which turn
 * out to be distinct renditions with distinct bytes, but the same photograph
 * re-uploaded under different media ids. Keying on the URL with its query
 * stripped would have merged files that differ and missed every one that
 * actually collides. No URL heuristic could have found them; only the bytes
 * do. A CDN serves one file under several addresses — `~mv2` suffixes,
 * resize query strings — so a migration keyed on the URL stores the same
 * photograph five times. Keyed on content it cannot: the unique index will not
 * let a second copy past, whatever it was called where it came from.
 *
 * Source addresses are kept, plural, as provenance. They are labels on a row.
 * They are never opened.
 */

export type ImageToIngest = {
  /** The image itself: raw bytes, or base64 when it arrived as JSON. */
  bytes: string | Uint8Array
  filename: string
  mimeType: string
  /** Where it came from, recorded for idempotency. Never retrieved. */
  sourceUrl: string
}

export type IngestOptions = {
  /** Slug of the host's media collection. */
  mediaSlug?: string
  /** Refuse anything larger. A migration that needs more says so. */
  maxBytes?: number
}

export type IngestResult = {
  /** Source URL to the id of the media document holding it. */
  map: Record<string, number | string>
  created: number
  /** Distinct files stored. Lower than `map` when one file had several URLs. */
  files: number
  refused: { reason: string; sourceUrl: string }[]
  /** Already present, matched on the hash of the bytes. */
  reused: number
}

/** 10 MB. A page image that exceeds this is a mistake worth seeing. */
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

/** Image types a school's pages actually carry. */
const ALLOWED_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
])

/**
 * Types a server sends meaning one of the accepted ones.
 *
 * Not accepted — named, so the refusal can say what to send. `image/jpg` in
 * particular is a common misconfiguration and was hit on the first real
 * migration through this.
 */
const NEAR_MISSES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/svg': 'image/svg+xml',
  'image/tif': 'image/tiff, which this does not accept — convert it',
  'image/x-png': 'image/png',
}

const decode = (bytes: string | Uint8Array): null | Uint8Array => {
  if (bytes instanceof Uint8Array) return bytes
  try {
    const binary = atob(bytes.replace(/^data:[^,]*,/, ''))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * A filename that cannot climb out of wherever it is written.
 *
 * The caller supplies it, and it reaches a filesystem. Everything but the last
 * segment is dropped and the rest is reduced to characters that name a file
 * and nothing else.
 */
export const safeFilename = (filename: string, mimeType: string): string => {
  const base = (filename.split(/[/\\]/).pop() ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120)

  if (base && /\.[A-Za-z0-9]{2,5}$/.test(base)) return base

  const extension = mimeType === 'image/svg+xml' ? 'svg' : (mimeType.split('/')[1] ?? 'bin')
  return `${base || 'image'}.${extension}`
}

/**
 * Brings images into the media library, once each.
 *
 * **Runs under the caller's access, so `req` must carry a user.** The create
 * goes out with `overrideAccess: false`, which is deliberate — a migration is
 * not a reason to write past a school's own rules — but it means calling this
 * directly with a bare `createLocalReq({})` fails with a plain 403 naming
 * neither the cause nor the remedy. Either pass a `req` with a user, or go
 * through `school_ingest_images`, which authenticates with the school's MCP
 * key. On a deployment whose first administrator does not exist yet, the MCP
 * key is the only authenticated identity there is, so the tool is not merely
 * the tidier path — it is the only one.
 *
 * Re-running a migration matches on `sourceUrl` and reuses what is there, so
 * three hundred images do not become six hundred on the second pass.
 */
export async function ingestImages(
  req: PayloadRequest,
  images: ImageToIngest[],
  options: IngestOptions = {},
): Promise<IngestResult> {
  const mediaSlug = options.mediaSlug ?? 'media'
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  const result: IngestResult = { created: 0, files: 0, map: {}, refused: [], reused: 0 }
  const tenant = await tenantOf(req.payload, req)

  for (const image of images) {
    const sourceUrl = image.sourceUrl?.trim()
    if (!sourceUrl) {
      result.refused.push({ reason: 'no source URL to record it under', sourceUrl: '' })
      continue
    }
    if (result.map[sourceUrl]) continue

    if (!ALLOWED_TYPES.has(image.mimeType)) {
      // `image/jpg` is not a registered type — the name is `image/jpeg` — and
      // a real CDN served it on a real migration. The list stays exactly as
      // strict; the caller is told what to send instead, because a refusal
      // that names the type and not the remedy costs somebody an afternoon.
      const meant = NEAR_MISSES[image.mimeType]

      result.refused.push({
        reason: meant
          ? `not an image type this accepts: ${image.mimeType} — did you mean ${meant}?`
          : `not an image type this accepts: ${image.mimeType}`,
        sourceUrl,
      })
      continue
    }

    const bytes = decode(image.bytes)
    if (!bytes || bytes.length === 0) {
      result.refused.push({ reason: 'the bytes could not be read', sourceUrl })
      continue
    }
    if (bytes.length > maxBytes) {
      result.refused.push({ reason: `${bytes.length} bytes exceeds the ${maxBytes} limit`, sourceUrl })
      continue
    }

    // The key: identical bytes are one file, whatever they were called.
    const contentHash = await sha256Bytes(bytes)

    const existing = await req.payload.find({
      collection: mediaSlug as never,
      limit: 1,
      overrideAccess: false,
      req,
      where: { contentHash: { equals: contentHash } },
    })

    const held = existing.docs[0]

    if (held) {
      result.map[sourceUrl] = held.id
      result.reused++

      // Another address for a file already here. Kept, because provenance is
      // how somebody later works out which page referred to what.
      const known = ((held as { sourceUrls?: { url?: string }[] }).sourceUrls ?? []).map(
        (entry) => entry.url,
      )
      if (!known.includes(sourceUrl)) {
        await req.payload.update({
          collection: mediaSlug as never,
          data: { sourceUrls: [...known.map((url) => ({ url })), { url: sourceUrl }] } as never,
          id: held.id,
          overrideAccess: false,
          req,
        })
      }
      continue
    }

    const created = await req.payload.create({
      collection: mediaSlug as never,
      data: {
        alt: '',
        contentHash,
        sourceUrls: [{ url: sourceUrl }],
        ...(tenant ? { tenant: tenant.id } : {}),
      } as never,
      file: {
        data: Buffer.from(bytes),
        mimetype: image.mimeType,
        name: safeFilename(image.filename, image.mimeType),
        size: bytes.length,
      },
      overrideAccess: false,
      req,
    })

    result.map[sourceUrl] = created.id
    result.created++
    result.files++
  }

  return result
}
