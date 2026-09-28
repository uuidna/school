import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cachedToken, expiryOf, withFreshToken } from './token.js'

/** A JWT whose payload says when it dies. Signature irrelevant — never verified here. */
const jwt = (expSeconds: number): string => {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds, sub: 'x' })).toString('base64url')
  return `header.${payload}.signature`
}

const clock = (start = 1_000_000) => {
  let t = start
  return { advance: (ms: number) => void (t += ms), now: () => t }
}

test('a JWT is believed about its own expiry', () => {
  assert.equal(expiryOf(jwt(1700)), 1_700_000)
})

// A GOOGLE ACCESS TOKEN IS OPAQUE and says nothing. That is not a broken token
// and not a failure to report — it is the other case, and it gets the other rule.
test('an opaque token yields no expiry rather than an error', () => {
  assert.equal(expiryOf('ya29.a0AfH6SM...opaque'), undefined)
  assert.equal(expiryOf(''), undefined)
  assert.equal(expiryOf('not.a.jwt'), undefined, 'three parts and still not base64 JSON')
})

test('the source is asked once, not once per request', async () => {
  let asks = 0
  const t = cachedToken(() => { asks += 1; return `token-${asks}` })

  assert.equal(await t.get(), 'token-1')
  assert.equal(await t.get(), 'token-1')
  assert.equal(await t.get(), 'token-1')
  assert.equal(asks, 1, 'a thousand-user walk asked for a token a thousand times before this')
})

test('an opaque token is renewed on its assumed lifetime', async () => {
  const c = clock()
  let asks = 0
  const t = cachedToken(() => `opaque-${++asks}`, { now: c.now, opaqueTtlMs: 60_000, skewMs: 0 })

  assert.equal(await t.get(), 'opaque-1')
  c.advance(59_000)
  assert.equal(await t.get(), 'opaque-1', 'still inside the assumed lifetime')
  c.advance(2_000)
  assert.equal(await t.get(), 'opaque-2', 'and renewed past it')
})

// RENEW BEFORE IT DIES, not after. A request that crosses the expiry while in
// flight is refused, and the skew is what stops that happening.
test('a JWT is renewed before expiry, by the skew', async () => {
  const c = clock(1_000_000)
  let asks = 0
  const t = cachedToken(() => { asks += 1; return jwt((c.now() + 300_000) / 1000) }, { now: c.now, skewMs: 60_000 })

  assert.equal(await t.get(), await t.get(), 'held while good')
  assert.equal(asks, 1)

  c.advance(241_000) // 59s of life left — inside the skew
  await t.get()
  assert.equal(asks, 2, 'renewed a minute early, so a request in flight does not cross the line')
})

test('concurrent callers share one fetch, never start several', async () => {
  let asks = 0
  const t = cachedToken(async () => {
    asks += 1
    await new Promise((r) => setTimeout(r, 10))
    return 'shared'
  })

  const all = await Promise.all([t.get(), t.get(), t.get(), t.get(), t.get()])

  assert.deepEqual(all, ['shared', 'shared', 'shared', 'shared', 'shared'])
  assert.equal(asks, 1, 'five pages starting at once must not start five token requests')
})

test('invalidate drops what is held', async () => {
  let asks = 0
  const t = cachedToken(() => `t-${++asks}`)
  assert.equal(await t.get(), 't-1')
  t.invalidate()
  assert.equal(await t.get(), 't-2')
})

// THE 401 EXCEPTION, STATED. The transport refuses to retry a 401 because it is
// an answer. This is a DIFFERENT request — same URL, new credential — and
// exactly one of them.
test('a 401 renews once and runs the request again with the new token', async () => {
  let asks = 0
  const t = cachedToken(() => `t-${++asks}`)
  const used: string[] = []

  const out = await withFreshToken(t, async (token) => {
    used.push(token)
    return new Response('', { status: used.length === 1 ? 401 : 200 })
  })

  assert.equal(out.status, 200)
  assert.deepEqual(used, ['t-1', 't-2'], 'the second attempt carried a different credential')
})

test('a second 401 is returned — the credential is wrong, not stale', async () => {
  let asks = 0
  const t = cachedToken(() => `t-${++asks}`)
  let calls = 0

  const out = await withFreshToken(t, async () => {
    calls += 1
    return new Response('', { status: 401 })
  })

  assert.equal(out.status, 401)
  assert.equal(calls, 2, 'exactly two — repeating past this is how an account gets locked')
})

test('a 403 is returned untouched — understood and not permitted', async () => {
  let asks = 0
  const t = cachedToken(() => `t-${++asks}`)
  let calls = 0

  const out = await withFreshToken(t, async () => {
    calls += 1
    return new Response('', { status: 403 })
  })

  assert.equal(out.status, 403)
  assert.equal(calls, 1, 'no amount of renewing changes a permission')
  assert.equal(asks, 1, 'and nothing was renewed')
})

test('a success renews nothing', async () => {
  let asks = 0
  const t = cachedToken(() => `t-${++asks}`)
  const out = await withFreshToken(t, async () => new Response('', { status: 200 }))
  assert.equal(out.status, 200)
  assert.equal(asks, 1)
})
