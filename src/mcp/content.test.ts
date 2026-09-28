import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { contentMcpTools } from './content.js'

// THE STATUTORY LINKS LIVE IN THE FOOTER. school_set_navigation wrote the
// header and nothing else, so the menu carrying a school's required
// publications could only be set by hand in the admin panel. The argument that
// fixed it writes to a different global, which is worth pinning: a menu written
// to the wrong one is a school's compliance links silently going nowhere.

const tool = contentMcpTools.find((entry) => entry.name === 'school_set_navigation')!

const run = async (args: Record<string, unknown>) => {
  const wrote: Record<string, unknown>[] = []
  const payload = {
    count: async () => ({ totalDocs: 1 }),
    find: async (a: { collection: string }) =>
      a.collection === 'tenants'
        ? { docs: [{ id: 1, domain: 'school.bg' }], hasNextPage: false, totalDocs: 1 }
        : { docs: [], hasNextPage: false, totalDocs: 0 },
    updateGlobal: async (a: Record<string, unknown>) => {
      wrote.push(a)
      return { navItems: (a.data as { navItems?: unknown }).navItems }
    },
  }
  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  const result = await tool.handler(args, req)
  return { result: JSON.parse(result.content[0]!.text), wrote }
}

const items = [{ label: 'Бюджет и отчети', url: '/dokumenti/byudzhet' }]

test('the header is still what an existing caller gets', async () => {
  // Callers that predate the argument must be unchanged by it.
  const { wrote } = await run({ items })

  assert.equal(wrote[0]!.slug, 'header')
})

test('the footer can be reached, which is where the statutory links live', async () => {
  const { wrote } = await run({ items, placement: 'footer' })

  assert.equal(wrote[0]!.slug, 'footer')
})

test('an unknown placement falls back to the header rather than inventing a global', async () => {
  // slug goes straight to updateGlobal. Anything but the two known menus must
  // not reach it.
  for (const placement of ['sidebar', '', 'HEADER', '../users', null, 42]) {
    const { wrote } = await run({ items, placement })
    assert.equal(wrote[0]!.slug, 'header', `placement ${JSON.stringify(placement)} reached a global`)
  }
})

test('the menu is written with access control on', async () => {
  const { wrote } = await run({ items, placement: 'footer' })

  assert.equal(wrote[0]!.overrideAccess, false)
})

test('the items are written in the order they were given', async () => {
  const ordered = [
    { label: 'Достъп до обществена информация', url: '/dostap' },
    { label: 'Защита на личните данни', url: '/gdpr' },
    { label: 'Профил на купувача', url: '/profil' },
  ]
  const { result, wrote } = await run({ items: ordered, placement: 'footer' })

  const written = (wrote[0]!.data as { navItems: { link: { label: string } }[] }).navItems
  assert.deepEqual(written.map((n) => n.link.label), ordered.map((i) => i.label))
  assert.equal(result.count, 3)
})

test('an empty menu is allowed — a school may clear one', async () => {
  const { result, wrote } = await run({ items: [], placement: 'footer' })

  assert.equal(result.count, 0)
  assert.deepEqual((wrote[0]!.data as { navItems: unknown[] }).navItems, [])
})

test('the tool declares the placements it accepts', () => {
  const placement = (tool.inputSchema.properties as Record<string, { enum?: string[] }>).placement

  assert.deepEqual(placement!.enum, ['header', 'footer'])
})
