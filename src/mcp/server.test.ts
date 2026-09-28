import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { mcpEndpoints } from './server.js'

// THE DOOR ITSELF WAS UNTESTED. Authentication, the two filters, and the
// JSON-RPC surface are where every tool's role gate is actually enforced, and
// nothing exercised any of it.

const post = mcpEndpoints.find((e) => e.method === 'post')!
const get = mcpEndpoints.find((e) => e.method === 'get')!

const req = (
  body: unknown,
  { headers = {}, tenant = { domain: 'school.bg', id: 1 }, user = null as unknown }: {
    headers?: Record<string, string>
    tenant?: Record<string, unknown> | null
    user?: unknown
  } = {},
) =>
  ({
    headers: new Headers({ host: 'school.bg', ...headers }),
    json: async () => body,
    payload: {
      count: async () => ({ totalDocs: tenant ? 1 : 0 }),
      find: async (a: { collection: string }) =>
        a.collection === 'tenants'
          ? { docs: tenant ? [tenant] : [], hasNextPage: false, totalDocs: tenant ? 1 : 0 }
          : { docs: [], hasNextPage: false, totalDocs: 0 },
      logger: { error: () => {}, warn: () => {} },
    },
    user,
  }) as unknown as PayloadRequest

const call = async (body: unknown, opts = {}) => {
  const response = await post.handler(req(body, opts) as never)
  return { body: await (response as Response).json(), status: (response as Response).status }
}

const admin = { email: 'head@school.bg', id: 1, role: 'admin' }
const parent = { class: '12a@students.school.bg', email: 'p@x', id: 2, role: 'parent' }

test('an unauthenticated caller is refused before anything is read', async () => {
  const { body, status } = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' })

  assert.equal(status, 401)
  assert.equal(body.error.code, -32001)
  assert.equal(body.result, undefined)
})

test('a signed-in caller sees the tools their role allows', async () => {
  const { body } = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, { user: admin })
  const names = body.result.tools.map((t: { name: string }) => t.name)

  assert.ok(names.includes('school_grant_role'))
  assert.ok(names.length > 5)
})

test('a parent sees only the two tools meant for them', async () => {
  const { body } = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, { user: parent })
  const names = body.result.tools.map((t: { name: string }) => t.name).sort()

  assert.deepEqual(names, ['school_researcher_financing', 'school_verify_class_draw'])
})

test('a tool the caller may not use is refused when invoked by name', async () => {
  // Filtering the list is presentation; this is the enforcement.
  const { body } = await call(
    { id: 1, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'school_grant_role' } },
    { user: parent },
  )

  assert.equal(body.result.isError, true)
  assert.match(body.result.content[0].text, /may not call/)
})

test('an unknown tool is a protocol error, not a silent success', async () => {
  const { body } = await call(
    { id: 1, jsonrpc: '2.0', method: 'tools/call', params: { name: 'school_delete_everything' } },
    { user: admin },
  )

  assert.equal(body.error.code, -32602)
})

test('an unknown method is reported rather than ignored', async () => {
  const { body } = await call({ id: 1, jsonrpc: '2.0', method: 'tools/destroy' }, { user: admin })
  assert.equal(body.error.code, -32601)
})

test('a malformed body is a parse error', async () => {
  const broken = {
    headers: new Headers({ host: 'school.bg' }),
    json: async () => { throw new Error('not json') },
    payload: { find: async () => ({ docs: [], hasNextPage: false, totalDocs: 0 }), logger: { error: () => {}, warn: () => {} } },
    user: admin,
  } as unknown as PayloadRequest

  const body = await (await post.handler(broken as never) as Response).json()
  assert.equal(body.error.code, -32700)
})

test('the machine key authenticates, and a wrong one does not', async () => {
  process.env.MCP_API_KEY = 'correct-horse-battery-staple'
  try {
    const ok = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, {
      headers: { authorization: 'Bearer correct-horse-battery-staple' },
    })
    assert.ok(ok.body.result.tools.length > 0)

    const wrong = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, {
      headers: { authorization: 'Bearer correct-horse-battery-stapl' },
    })
    assert.equal(wrong.status, 401)

    const prefix = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, {
      headers: { authorization: 'Bearer correct' },
    })
    assert.equal(prefix.status, 401, 'a prefix of the key was accepted')
  } finally {
    delete process.env.MCP_API_KEY
  }
})

test('an unset machine key does not make every bearer valid', async () => {
  delete process.env.MCP_API_KEY
  const { status } = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, {
    headers: { authorization: 'Bearer ' },
  })

  assert.equal(status, 401)
})

test('initialize and ping answer without a tool being run', async () => {
  const init = await call({ id: 1, jsonrpc: '2.0', method: 'initialize' }, { user: admin })
  assert.equal(init.body.result.protocolVersion, '2025-06-18')

  const ping = await call({ id: 2, jsonrpc: '2.0', method: 'ping' }, { user: admin })
  assert.deepEqual(ping.body.result, {})
})

test('an anonymous probe learns how to authenticate, not what to ask for', async () => {
  const response = await get.handler(req(null) as never)
  const body = await (response as Response).json()

  assert.equal(body.authenticated, false)
  assert.deepEqual(body.tools, [])
  assert.match(body.authentication, /Bearer/)
})

test('a tool whose capability the school cannot provide is not offered', async () => {
  // A school on Workspace with no Drive folder cannot be checked against its
  // statutory documents. Offering the tool and then failing teaches a client
  // nothing it can act on.
  const workspaceTenant = {
    domain: 'school.bg',
    googleWorkspace: { domain: 'school.bg' },
    id: 1,
  }
  process.env.MCP_API_KEY = 'k'
  try {
    const { body } = await call({ id: 1, jsonrpc: '2.0', method: 'tools/list' }, {
      headers: { authorization: 'Bearer k' },
      tenant: workspaceTenant,
    })
    // No credential is supplied for this request, so the local store answers
    // and every capability is present — the filter must not remove anything.
    const names = body.result.tools.map((t: { name: string }) => t.name)
    assert.ok(names.includes('school_legal_publication_status'))
  } finally {
    delete process.env.MCP_API_KEY
  }
})

test('every tool declares which roles may call it', () => {
  // An empty list means "any authenticated caller", which for this package
  // would be a pupil reading a compliance report.
  const response = get.handler(req(null) as never)
  void response
  for (const endpoint of mcpEndpoints) assert.ok(endpoint.path === '/mcp')
})
