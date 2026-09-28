import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Config } from 'payload'

import { googleWorkspacePlugin, workspaceConfigOf } from './index.js'

// THIS PLUGIN ADDS NO PEOPLE AND NO DOCUMENTS, and that absence is the test.
// Creating a students collection here would replace the school's system rather
// than extend it, and would duplicate minors' records in order to audit them.

test('it adds no collection at all — the school keeps its own', () => {
  const base = { collections: [{ fields: [], slug: 'tenants' }] } as unknown as Config
  const out = googleWorkspacePlugin()(base) as Config

  assert.equal(out.collections!.length, 1)
  assert.equal(out.collections![0]!.slug, 'tenants')
})

test('a school states its own Workspace on its own record', () => {
  const base = { collections: [{ fields: [], slug: 'tenants' }] } as unknown as Config
  const tenants = (googleWorkspacePlugin()(base) as Config).collections![0]!

  assert.ok(tenants.fields.some((f) => 'name' in f && f.name === 'googleWorkspace'))
})

test('two schools on one instance can point at different Workspaces', () => {
  const a = workspaceConfigOf({ googleWorkspace: { domain: 'a-school.bg' } })
  const b = workspaceConfigOf({ googleWorkspace: { domain: 'b-school.bg' } })

  assert.equal(a!.domains.students, 'students.a-school.bg')
  assert.equal(b!.domains.students, 'students.b-school.bg')
})

test('a school that has stated no domain is not configured, rather than defaulted', () => {
  assert.equal(workspaceConfigOf({}), null)
  assert.equal(workspaceConfigOf({ googleWorkspace: { domain: '   ' } }), null)
  assert.equal(workspaceConfigOf(null), null)
})

test('role groups are read from the school, never guessed', () => {
  const stated = workspaceConfigOf({
    googleWorkspace: {
      domain: 'school.bg',
      roleGroups: [{ group: 'Registrars@School.bg', role: 'registrar' }],
    },
  })

  assert.equal(stated!.roles.groups!['registrars@school.bg'], 'registrar')
})

test('a school with no stated groups gets an empty mapping, not a default one', () => {
  // A guessed mapping hands somebody a role the school never granted.
  const stated = workspaceConfigOf({ googleWorkspace: { domain: 'school.bg' } })

  assert.deepEqual(stated!.roles.groups, {})
})

test('writing to Directory is off unless the school turned it on', () => {
  assert.equal(workspaceConfigOf({ googleWorkspace: { domain: 'school.bg' } })!.writable, false)
  assert.equal(
    workspaceConfigOf({ googleWorkspace: { domain: 'school.bg', writable: true } })!.writable,
    true,
  )
})

test('a truthy-but-not-true writable flag does not grant write access', () => {
  const stated = workspaceConfigOf({ googleWorkspace: { domain: 'school.bg', writable: 'yes' } })

  assert.equal(stated!.writable, false)
})
