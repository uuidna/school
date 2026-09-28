import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fakePayload, fakeRequest } from '../payload/testing.js'
import { contentMcpTools } from './content.js'

/**
 * The three tools that write and list a school's public pages.
 *
 * They were covered by the aggregate folds and by no test that named them,
 * which matters most for the two that WRITE: publishing under a slug that
 * already exists must update that page rather than create a second one with
 * the same address, and a school discovering two pages at one URL discovers it
 * from a parent who followed the wrong link.
 */
const tool = (name: string) => contentMcpTools.find((entry) => entry.name === name)!

const run = async (name: string, args: Record<string, unknown>, existing: Record<string, unknown>[] = []) => {
  const { calls, payload } = fakePayload({ docs: { pages: existing, posts: existing } })
  const result = await tool(name).handler(args, fakeRequest(payload) as never)
  return { calls, out: JSON.parse(result.content[0]!.text) }
}

test('publishing a new page creates it and returns the address a parent will use', async () => {
  const { calls, out } = await run('school_publish_page', {
    markdown: '## Добре дошли\n\nТова е страница.',
    title: 'Приём 2027',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.op, 'create')
  assert.equal(out.action, 'created')
  assert.equal(out.url, `/${out.slug}`, 'the url is the slug, not a second opinion about it')
})

// THE ONE THAT MATTERS. Publishing under an existing slug must UPDATE it. A
// second page at one address is discovered by a parent following the wrong
// link, and by then both exist.
test('publishing under a slug that already exists updates it, never duplicates', async () => {
  const { calls, out } = await run(
    'school_publish_page',
    { markdown: 'нов текст', slug: 'priem-2027', title: 'Приём 2027' },
    [{ id: 7, slug: 'priem-2027' }],
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.op, 'update', 'one page, one address')
  assert.equal(calls[0]!.id, 7)
  assert.equal(out.action, 'updated')
  assert.equal(out.id, 7)
})

// A BULGARIAN TITLE MUST YIELD A USABLE URL. Left untransliterated it becomes
// percent-encoded Cyrillic, which is legal, unreadable, and impossible to read
// down a telephone to a parent.
test('a Cyrillic title is transliterated into a slug somebody can read aloud', async () => {
  const { out } = await run('school_publish_page', { markdown: 'x', title: 'Приём 2027' })

  assert.match(out.slug, /^[a-z0-9-]+$/, `slug was ${out.slug}`)
  assert.ok(out.slug.length > 0)
})

test('an explicit slug is honoured rather than re-derived from the title', async () => {
  const { out } = await run('school_publish_page', { markdown: 'x', slug: 'admissions', title: 'Приём 2027' })
  assert.equal(out.slug, 'admissions')
})

test('a draft stays a draft — status is carried, not assumed', async () => {
  const { calls } = await run('school_publish_page', { markdown: 'x', status: 'draft', title: 'Чернова' })
  assert.equal((calls[0]!.data as { _status?: string })._status, 'draft')

  const { calls: live } = await run('school_publish_page', { markdown: 'x', title: 'Живо' })
  assert.equal((live[0]!.data as { _status?: string })._status, 'published', 'published by default')
})

test('a post is written to posts, not to pages', async () => {
  const { calls } = await run('school_publish_post', { markdown: 'съобщение', title: 'Новина' })
  assert.equal(calls[0]!.collection, 'posts')
})

test('listing content reads and never writes', async () => {
  const { calls } = await run('school_list_content', {}, [{ id: 1, slug: 'a', title: 'A' }])
  assert.deepEqual(calls, [], 'a listing that writes is not a listing')
})

test('the two writers declare that they write, and the lister does not', () => {
  assert.equal(tool('school_publish_page').writes, true)
  assert.equal(tool('school_publish_post').writes, true)
  assert.equal(tool('school_list_content').writes, false)
  for (const name of ['school_publish_page', 'school_publish_post', 'school_list_content']) {
    assert.deepEqual(tool(name).needs, ['content'], `${name} needs the content capability`)
  }
})

// NO PUPIL PUBLISHES A PAGE. The roles are the staff who may speak for the
// school, and a pupil or parent is not among them.
test('only staff who may speak for the school can publish', () => {
  assert.deepEqual(tool('school_publish_page').allowedRoles, ['admin', 'teacher'])
  assert.deepEqual(tool('school_publish_post').allowedRoles, ['admin', 'teacher'])
  for (const role of ['student', 'parent']) {
    assert.ok(!tool('school_publish_page').allowedRoles.includes(role as never), `${role} may not publish`)
  }
})
