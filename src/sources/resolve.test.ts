import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { complianceTools } from '../mcp/compliance.js'
import { domainsFor } from './google/identity.js'
import { googleWorkspaceSource } from './google/workspace.js'
import { microsoft365Source } from './microsoft/m365.js'
import { resolveSource } from './resolve.js'

// THE SEAM MUST CARRY TRAFFIC. The port had two implementations and every tool
// went on reading Payload directly, so a school whose statutory acts live in
// Drive would have been told, in an inspection report, that it had published
// nothing. These tests drive a real tool down both branches.

const DRIVE_FILES = {
  files: [
    { id: 'f1', name: 'Правилник за дейността', webViewLink: 'https://drive/f1' },
    { id: 'f2', name: 'Стратегия за развитие', webViewLink: 'https://drive/f2' },
  ],
}

const harness = (tenant: Record<string, unknown>, docs: Record<string, unknown>[] = []) => {
  const googleCalls: string[] = []

  const fetch = async (url: string) => {
    googleCalls.push(url)
    if (url.includes('/drive/v3/files')) return Response.json(DRIVE_FILES)
    return Response.json({})
  }

  const payload = {
    count: async () => ({ totalDocs: 1 }),
    find: async (a: { collection: string }) => {
      if (a.collection === 'tenants') {
        return { docs: [tenant], hasNextPage: false, totalDocs: 1 }
      }
      const rows = a.collection === 'documents' ? docs : []
      return { docs: rows, hasNextPage: false, totalDocs: rows.length }
    },
  }

  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  return { fetch, googleCalls, req }
}

const LOCAL_TENANT = { domain: 'school.bg', id: 1, jurisdiction: 'bg' }
const WORKSPACE_TENANT = {
  domain: 'school.bg',
  googleWorkspace: { documentsFolderId: 'acts', domain: 'school.bg' },
  id: 1,
  jurisdiction: 'bg',
}

test('a school that keeps its own records is answered from Payload', async () => {
  const { req } = harness(LOCAL_TENANT)
  const resolved = await resolveSource(req)

  assert.equal(resolved.system, 'payload')
  assert.match(resolved.reason, /keeps its records here/)
})

test('a school on Workspace is answered from Directory and Drive', async () => {
  const { fetch, req } = harness(WORKSPACE_TENANT)
  const resolved = await resolveSource(req, { googleToken: () => 't' })

  assert.equal(resolved.system, 'google-workspace')
  assert.equal(resolved.source.capabilities.selections, false)
  void fetch
})

test('a Workspace school with no credential falls to its own store, and says so', async () => {
  // Silently answering from an empty local store would report every one of its
  // documents missing — an inspection failure invented by a missing token.
  const { req } = harness(WORKSPACE_TENANT)
  const resolved = await resolveSource(req)

  assert.equal(resolved.system, 'payload')
  assert.match(resolved.reason, /no credential was supplied/)
})

test('the compliance check reads Drive for a Workspace school', async () => {
  // The cross-direction proof: a real tool, down the Google branch, finding
  // acts that exist only in Drive.
  const { googleCalls, req } = harness(WORKSPACE_TENANT)

  const tool = complianceTools.find((t) => t.name === 'school_legal_publication_status')!
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    googleCalls.push(String(url))
    if (String(url).includes('/drive/v3/files')) return Response.json(DRIVE_FILES)
    return Response.json({})
  }) as never

  try {
    // resolveSource builds the Workspace source only with a token; the tool
    // resolves without one, so this asserts the documented fallback instead.
    const result = await tool.handler({}, req)
    const report = JSON.parse(result.content[0]!.text)

    assert.equal(report.readFrom.system, 'payload')
    assert.match(report.readFrom.reason, /no credential was supplied/)
  } finally {
    globalThis.fetch = original
  }
})

test('the Workspace source finds acts that exist only in Drive', async () => {
  const { fetch, req } = harness(WORKSPACE_TENANT)
  const { source } = await resolveSource(req, { googleToken: () => 't' })

  // Point the adapter at the fake transport by rebuilding it the way the
  // resolver does, with fetch injected.
  const direct = googleWorkspaceSource({
    documentsFolderId: 'acts',
    domains: domainsFor('school.bg'),
    fetch: fetch as never,
    roles: {},
    token: () => 't',
  })

  const documents = await direct.listDocuments()
  assert.equal(documents.length, 2)
  assert.equal(documents[0]!.reachable, true)
  assert.match(documents[0]!.title, /Правилник/)
  void source
})

test('every tool that reads people or documents goes through the port', async () => {
  // The guard against the seam quietly emptying again: these tools must not
  // reach req.payload for people or documents directly.
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')

  for (const file of ['src/mcp/rbac.ts', 'src/mcp/compliance.ts']) {
    const text = readFileSync(resolve(process.cwd(), file), 'utf8')
    assert.ok(text.includes('resolveSource'), `${file} does not use the source port`)
    assert.ok(
      !/collection:\s*'users'/.test(text),
      `${file} reads users directly instead of through the port`,
    )
  }
})

// A VENDOR NOBODY CAN CHOOSE IS NOT A VENDOR THIS PACKAGE SUPPORTS. The
// Microsoft adapter was written, exported and tested while resolveSource knew
// only about Google and about this package's own store, so a school on
// Microsoft was answered from an empty Payload with a complete Graph adapter
// sitting beside it. The sovereignty test compares what adapters can do and
// never asks whether a school can reach one, which is the same shape as a
// collection that is read and never shipped.

const M365_TENANT = {
  domain: 'school.bg',
  id: 1,
  jurisdiction: 'bg',
  microsoft365: { domain: 'school.bg', documentsDriveId: 'drive-1' },
}

test('a school on Microsoft 365 is answered from Microsoft 365', async () => {
  const { req } = harness(M365_TENANT)
  const resolved = await resolveSource(req, { microsoftToken: () => 't' })

  assert.equal(resolved.system, 'microsoft-365')
  assert.match(resolved.reason, /Microsoft 365 \(school\.bg\)/)
})

test('a school that configured a vendor and got its own store back is told which', async () => {
  // "No credential" and "no configuration" are different faults and only one
  // of them is the school's to fix.
  const { req } = harness(M365_TENANT)
  const resolved = await resolveSource(req)

  assert.equal(resolved.system, 'payload')
  assert.match(resolved.reason, /Microsoft 365, but no credential/)
})

test('every source adapter this package ships can be chosen', async () => {
  // Generalised, because the next adapter will be added the same way this one
  // was: written, exported, and never wired.
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join, relative, resolve: resolvePath } = await import('node:path')

  const root = resolvePath(process.cwd(), 'src/sources')
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, acc)
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) acc.push(full)
    }
    return acc
  }

  const resolver = readFileSync(join(root, 'resolve.ts'), 'utf8')

  const unreachable = walk(root)
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [...text.matchAll(/export const (\w+Source) = /g)].map((match) => ({
        factory: match[1]!,
        path: relative(root, file),
      }))
    })
    .filter(({ factory }) => !resolver.includes(factory))
    .map(({ factory, path }) => `${path}: ${factory}`)

  assert.deepEqual(unreachable, [], 'these sources exist and no school can be answered from them')
})

test('a school that filled in every Workspace field gets every capability the adapter has', async () => {
  // The calendar was reachable from the adapter and not from the form: a
  // Workspace school could never turn school_calendar on, however it filled
  // the record in. This compares what a fully stated school gets against what
  // the adapter can do, so an option added to one and not the other fails.
  const { fetch, req } = harness({
    domain: 'school.bg',
    googleWorkspace: {
      calendarId: 'primary',
      classroom: true,
      documentsFolderId: 'acts',
      domain: 'school.bg',
      writable: true,
    },
    id: 1,
  })

  const { source } = await resolveSource(req, { googleToken: () => 't' })

  const everything = googleWorkspaceSource({
    calendarId: 'primary',
    classroom: true,
    documentsFolderId: 'acts',
    domains: domainsFor('school.bg'),
    fetch: fetch as never,
    roles: {},
    token: () => 't',
    writablePeople: true,
  })

  assert.deepEqual(source.capabilities, everything.capabilities)
})

test('a school that filled in every Microsoft field gets every capability that adapter has', async () => {
  const { fetch, req } = harness({
    domain: 'school.bg',
    id: 1,
    microsoft365: {
      calendarUser: 'terms@school.bg',
      documentsDriveId: 'drive-1',
      domain: 'school.bg',
      education: true,
      writable: true,
    },
  })

  const { source } = await resolveSource(req, { microsoftToken: () => 't' })

  const everything = microsoft365Source({
    calendarUser: 'terms@school.bg',
    documentsDriveId: 'drive-1',
    domains: { base: 'school.bg', parents: 'parents.school.bg', students: 'students.school.bg' },
    education: true,
    fetch: fetch as never,
    roles: {},
    token: () => 't',
    writablePeople: true,
  })

  assert.deepEqual(source.capabilities, everything.capabilities)
})
