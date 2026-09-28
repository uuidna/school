import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CATALOGUE, llmsTxt, mcpManifest } from './discovery.js'

const ORIGIN = 'https://school.uuidna.com'

test('the catalogue IS the served set — not a second list of it', async () => {
  // If these ever diverge, the manifest advertises tools the door does not
  // serve, or hides tools it does. Read from the same arrays the RPC door
  // builds from, so the only way to disagree is to edit one and not the other.
  const server = await import('./server.js')
  const served = (server as unknown as { TOOLS?: unknown[] }).TOOLS
  // TOOLS is module-private by design; the catalogue is asserted against the
  // registry arrays instead, which is what TOOLS is built from.
  assert.equal(served, undefined, 'TOOLS stays private; the catalogue is the public reading of it')
  assert.ok(CATALOGUE.length > 20, `the catalogue holds ${CATALOGUE.length} tools`)
  assert.equal(new Set(CATALOGUE.map((t) => t.name)).size, CATALOGUE.length, 'no tool is listed twice')
})

test('the manifest names the endpoint a machine will call', () => {
  const m = mcpManifest(ORIGIN, 'uuidna-school')
  assert.equal(m.endpoint, 'https://school.uuidna.com/api/mcp')
  assert.equal(m.protocol, 'mcp')
  assert.equal(m.transport, 'http')
  assert.deepEqual(m.authentication.schemes, ['bearer', 'cookie'])
})

test('a trailing slash on the origin does not become a double slash', () => {
  assert.equal(mcpManifest('https://school.uuidna.com/').endpoint, 'https://school.uuidna.com/api/mcp')
  assert.match(llmsTxt('https://school.uuidna.com///'), /https:\/\/school\.uuidna\.com\/api\/mcp/)
})

test('two deployments of one version publish the same manifest, byte for byte', () => {
  // Sorted on purpose: an unordered list makes a diff between two schools look
  // like a difference when it is only a map iteration order.
  assert.deepEqual(mcpManifest(ORIGIN), mcpManifest(ORIGIN))
  const names = mcpManifest(ORIGIN).tools.map((t) => t.name)
  assert.deepEqual(names, [...names].sort(), 'tools are sorted')
})

test('the manifest publishes the CATALOGUE, never an entitlement', () => {
  const m = mcpManifest(ORIGIN)
  // Each entry says which roles MAY call it. That is what exists, not what the
  // reader may do — the role gate and Payload access still run on every call.
  for (const tool of m.tools) {
    assert.ok(Array.isArray(tool.roles), `${tool.name} names the roles that may call it`)
    assert.equal(typeof tool.writes, 'boolean')
  }
  assert.ok(m.tools.some((t) => t.writes), 'some tools write, and the manifest says which')
  assert.ok(m.tools.some((t) => !t.writes), 'and some do not')
})

test('llms.txt answers the two questions a stranger has, in its first lines', () => {
  const text = llmsTxt(ORIGIN, 'uuidna-school')
  const head = text.split('\n').slice(0, 4).join('\n')
  assert.match(head, /uuidna-school/, 'what this is')
  assert.match(head, /\/api\/mcp/, 'where to call it')
  assert.match(text, /\.well-known\/mcp\.json/)
  assert.match(text, /`tools\/list` returns only the tools your role allows/)
})

test('llms.txt states the refusals, not only the offerings', () => {
  const text = llmsTxt(ORIGIN)
  assert.match(text, /No tool creates or deletes an account/)
  assert.match(text, /pseudonymous handles/)
  assert.match(text, /2016\/679/)
})

test('the tool count in the prose is the real one', () => {
  // A number typed beside a list is a number that goes stale.
  const text = llmsTxt(ORIGIN)
  assert.match(text, new RegExp(`${CATALOGUE.length} tools`))
  const writes = CATALOGUE.filter((t) => t.writes === true).length
  assert.match(text, new RegExp(`${writes} of which write`))
})
