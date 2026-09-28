import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { ingestImages, safeFilename } from './ingest.js'

// THE GUARANTEE IS THAT NOTHING IS FETCHED AND NOTHING IS STORED TWICE. The
// first is why there is no allowlist to maintain; the second is why a CDN
// serving one photograph under five addresses does not put five copies in a
// school's library.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')
const OTHER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]).toString('base64')

const library = () => {
  const rows: Record<string, unknown>[] = []
  let next = 1

  const payload = {
    count: async () => ({ totalDocs: 1 }),
    create: async (a: Record<string, unknown>) => {
      const doc = { id: next++, ...(a.data as Record<string, unknown>), file: a.file }
      rows.push(doc)
      return doc
    },
    find: async (a: { collection: string; where?: { contentHash?: { equals?: string } } }) => {
      if (a.collection === 'tenants') {
        return { docs: [{ id: 7, domain: 'school.bg' }], hasNextPage: false, totalDocs: 1 }
      }
      const wanted = a.where?.contentHash?.equals
      const docs = rows.filter((r) => r.contentHash === wanted)
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
    update: async (a: Record<string, unknown>) => {
      const doc = rows.find((r) => r.id === a.id)!
      Object.assign(doc, a.data)
      return doc
    },
  }

  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  return { req, rows }
}

const image = (over: Record<string, string> = {}) => ({
  bytes: PNG,
  filename: 'photo.png',
  mimeType: 'image/png',
  sourceUrl: 'https://static.wixstatic.com/media/a~mv2.png',
  ...over,
})

test('nothing in this module retrieves anything', async () => {
  // The reason there is no allowlist: no fetch, no address a caller can point
  // the server at, nothing to fence.
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const source = readFileSync(resolve(process.cwd(), 'src/media/ingest.ts'), 'utf8')

  assert.ok(!/\bfetch\(/.test(source), 'ingest fetches')
  assert.ok(!/XMLHttpRequest|http\.get|https\.get/.test(source))
})

test('one file is stored once, whatever it was called', async () => {
  // A CDN serves the same photograph under several addresses.
  const { req, rows } = library()
  const result = await ingestImages(req, [
    image({ sourceUrl: 'https://cdn/a.png' }),
    image({ sourceUrl: 'https://cdn/a~mv2.png' }),
    image({ sourceUrl: 'https://cdn/a.png?w=800' }),
  ])

  assert.equal(rows.length, 1, 'the same bytes were stored more than once')
  assert.equal(result.created, 1)
  assert.equal(result.reused, 2)
  assert.equal(Object.keys(result.map).length, 3)
  assert.equal(new Set(Object.values(result.map)).size, 1, 'the three URLs point at different files')
})

test('every address a file was found at is kept', async () => {
  const { req, rows } = library()
  await ingestImages(req, [
    image({ sourceUrl: 'https://cdn/a.png' }),
    image({ sourceUrl: 'https://cdn/a~mv2.png' }),
  ])

  const urls = (rows[0]!.sourceUrls as { url: string }[]).map((entry) => entry.url)
  assert.deepEqual(urls, ['https://cdn/a.png', 'https://cdn/a~mv2.png'])
})

test('different files are different rows', async () => {
  const { req, rows } = library()
  await ingestImages(req, [
    image({ sourceUrl: 'https://cdn/a.png' }),
    image({ bytes: OTHER, sourceUrl: 'https://cdn/b.png' }),
  ])

  assert.equal(rows.length, 2)
  assert.notEqual(rows[0]!.contentHash, rows[1]!.contentHash)
})

test('running a migration twice does not double the library', async () => {
  const { req, rows } = library()
  const batch = [image({ sourceUrl: 'https://cdn/a.png' }), image({ bytes: OTHER, sourceUrl: 'https://cdn/b.png' })]

  await ingestImages(req, batch)
  const second = await ingestImages(req, batch)

  assert.equal(rows.length, 2)
  assert.equal(second.created, 0)
  assert.equal(second.reused, 2)
})

test('the map still answers for every URL on a re-run', async () => {
  const { req } = library()
  const batch = [image({ sourceUrl: 'https://cdn/a.png' })]

  const first = await ingestImages(req, batch)
  const second = await ingestImages(req, batch)

  assert.deepEqual(second.map, first.map)
})

test('something that is not an image is refused, with the reason', async () => {
  const { req, rows } = library()
  const result = await ingestImages(req, [
    image({ mimeType: 'text/html', sourceUrl: 'https://cdn/page.html' }),
    image({ mimeType: 'application/pdf', sourceUrl: 'https://cdn/doc.pdf' }),
  ])

  assert.equal(rows.length, 0)
  assert.equal(result.refused.length, 2)
  assert.match(result.refused[0]!.reason, /not an image type/)
})

test('something too large is refused rather than stored', async () => {
  const { req, rows } = library()
  const result = await ingestImages(req, [image()], { maxBytes: 4 })

  assert.equal(rows.length, 0)
  assert.match(result.refused[0]!.reason, /exceeds the 4 limit/)
})

test('bytes that cannot be read are refused, not stored empty', async () => {
  const { req, rows } = library()
  const result = await ingestImages(req, [image({ bytes: '!!! not base64 !!!' })])

  assert.equal(rows.length, 0)
  assert.equal(result.refused.length, 1)
})

test('an image with no source URL is refused — there is nothing to key it to', async () => {
  const { req } = library()
  const result = await ingestImages(req, [image({ sourceUrl: '   ' })])

  assert.equal(result.refused.length, 1)
  assert.match(result.refused[0]!.reason, /no source URL/)
})

test('a filename cannot climb out of where it is written', () => {
  // The caller supplies it and it reaches a filesystem.
  assert.equal(safeFilename('../../etc/passwd', 'image/png'), 'passwd.png')
  assert.equal(safeFilename('/absolute/path/a.png', 'image/png'), 'a.png')
  assert.equal(safeFilename('..\\\\windows\\\\b.png', 'image/png'), 'b.png')
  assert.ok(!safeFilename('....//x', 'image/png').includes('/'))
})

test('a filename keeps an extension matching what it is', () => {
  assert.equal(safeFilename('photo', 'image/jpeg'), 'photo.jpeg')
  assert.equal(safeFilename('drawing', 'image/svg+xml'), 'drawing.svg')
  assert.equal(safeFilename('', 'image/png'), 'image.png')
})

test('media lands in the school it was ingested for', async () => {
  const { req, rows } = library()
  await ingestImages(req, [image()])

  assert.equal(rows[0]!.tenant, 7)
})

test('the library is written with access control on', async () => {
  const seen: Record<string, unknown>[] = []
  const { req } = library()
  const payload = req.payload as unknown as { create: (a: Record<string, unknown>) => Promise<unknown> }
  const original = payload.create
  payload.create = async (a) => { seen.push(a); return original(a) }

  await ingestImages(req, [image()])

  assert.equal(seen[0]!.overrideAccess, false)
})

test('a near-miss type is refused, and told what to send', async () => {
  // wixstatic served Content-Type: image/jpg on a real migration. That is not
  // a registered type — the name is image/jpeg — so the list stays strict and
  // the caller learns the remedy instead of losing an afternoon to it.
  const { req, rows } = library()
  const result = await ingestImages(req, [image({ mimeType: 'image/jpg' })])

  assert.equal(rows.length, 0, 'a near miss was accepted')
  assert.match(result.refused[0]!.reason, /did you mean image\/jpeg/)
})

test('a type that is simply wrong gets no invented suggestion', async () => {
  const { req } = library()
  const result = await ingestImages(req, [image({ mimeType: 'application/zip' })])

  assert.match(result.refused[0]!.reason, /not an image type this accepts/)
  assert.ok(!/did you mean/.test(result.refused[0]!.reason))
})

test('the hint does not widen what is accepted', async () => {
  // Every near miss is still a refusal. The list is the list.
  const { req, rows } = library()
  const misses = ['image/jpg', 'image/pjpeg', 'image/svg', 'image/x-png', 'image/tif']

  const result = await ingestImages(
    req,
    misses.map((mimeType, i) => image({ mimeType, sourceUrl: `https://cdn/${i}` })),
  )

  assert.equal(rows.length, 0, 'a near miss was stored')
  assert.equal(result.refused.length, misses.length)
})
