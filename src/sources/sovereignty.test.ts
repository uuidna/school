import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { domainsFor } from './google/identity.js'
import { googleWorkspaceSource } from './google/workspace.js'
import { microsoft365Source } from './microsoft/m365.js'
import { payloadSource } from './payload.js'

// NO FEATURE MAY BE GOOGLE-ONLY. A school must be able to run everything here
// without Google, so anything the Workspace adapter can do, the self-hosted one
// must do too. This is the check that keeps that true: the moment a capability
// is added for Google and not for the local store, a school that declines
// Google silently gets a smaller package, and nothing else would say so.

const req = () =>
  ({
    headers: new Headers({ host: 'school.bg' }),
    payload: {
      count: async () => ({ totalDocs: 1 }),
      find: async () => ({ docs: [], hasNextPage: false, totalDocs: 0 }),
    },
  }) as unknown as PayloadRequest

const local = payloadSource(req())

const microsoft = microsoft365Source({
  calendarUser: 'terms@school.bg',
  documentsDriveId: 'drive-1',
  education: true,
  domains: { base: 'school.bg', parents: 'parents.school.bg', students: 'students.school.bg' },
  fetch: (async () => Response.json({})) as never,
  roles: {},
  token: () => 't',
  writablePeople: true,
})

const workspace = googleWorkspaceSource({
  calendarId: 'primary',
  classroom: true,
  documentsFolderId: 'acts',
  domains: domainsFor('school.bg'),
  fetch: (async () => Response.json({})) as never,
  roles: {},
  token: () => 't',
  writablePeople: true,
})

/** Every adapter that talks to somebody else's system. */
const vendors = { 'Google Workspace': workspace, 'Microsoft 365': microsoft }

test('the self-hosted source does everything every vendor does', () => {
  // The rule is not about Google. It is that choosing any vendor, or none,
  // must not cost a school a feature.
  for (const [vendor, source] of Object.entries(vendors)) {
    const missing = Object.entries(source.capabilities)
      .filter(([name, able]) => able && !local.capabilities[name as never])
      .map(([name]) => name)

    assert.deepEqual(missing, [], `these work only with ${vendor}`)
  }
})

test('the vendors answer the same questions as each other', () => {
  // A school moving from one to the other should not find a gap where a
  // feature used to be.
  assert.deepEqual(
    Object.keys(workspace.capabilities).sort(),
    Object.keys(microsoft.capabilities).sort(),
  )

  for (const name of Object.keys(workspace.capabilities)) {
    assert.equal(
      workspace.capabilities[name as never],
      microsoft.capabilities[name as never],
      `${name} differs between Workspace and Microsoft 365 on equivalent configuration`,
    )
  }
})

test('the self-hosted source does more, not less', () => {
  // Workspace has no notion of a draw nobody can rig or a school website; the
  // local store has both. That asymmetry is the right direction.
  assert.equal(local.capabilities.selections, true)
  assert.equal(workspace.capabilities.selections, false)
  assert.equal(local.capabilities.content, true)
  assert.equal(workspace.capabilities.content, false)
})

test('every source answers the same set of questions', () => {
  // A capability without a method behind it is a promise nothing keeps.
  const methods = (source: object) =>
    Object.keys(source)
      .filter((key) => typeof (source as Record<string, unknown>)[key] === 'function')
      .sort()

  assert.deepEqual(methods(local), methods(workspace))
  assert.deepEqual(methods(local), methods(microsoft))
})

test('every capability the port declares is answered by both', () => {
  const declared = Object.keys(local.capabilities).sort()

  assert.deepEqual(Object.keys(workspace.capabilities).sort(), declared)
  assert.ok(declared.includes('calendar'))
  assert.ok(declared.includes('groups'))
})

test('a school with no Google configuration still gets a working source', () => {
  // resolveSource falls to the local store, and the local store is complete.
  for (const [name, able] of Object.entries(local.capabilities)) {
    assert.equal(able, true, `${name} is unavailable to a school that declines Google`)
  }
})
