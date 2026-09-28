import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RETRYABLE_STATUS, TransportTimeout, backoffFor, request, retryAfterMs } from './transport.js'

/** A fetch that answers from a script, recording what it was asked. */
const scripted = (...answers: (Response | (() => never))[]) => {
  const seen: string[] = []
  let i = 0
  const fetch = async (url: string) => {
    seen.push(String(url))
    const next = answers[Math.min(i++, answers.length - 1)]!
    return typeof next === 'function' ? next() : next
  }
  return { fetch, seen }
}

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response('', { headers, status: code })

/** Waits are recorded, never taken — the schedule is asserted, not endured. */
const recorder = () => {
  const waited: number[] = []
  return { wait: async (ms: number) => void waited.push(ms), waited }
}

test('a success is returned on the first attempt, with no waiting', async () => {
  const { fetch, seen } = scripted(status(200))
  const { wait, waited } = recorder()

  const out = await request('https://x/1', {}, { fetch, wait })

  assert.equal(out.status, 200)
  assert.equal(seen.length, 1)
  assert.deepEqual(waited, [])
})

// THE HALF THAT IS DANGEROUS TO GET WRONG. 400, 401, 403 and 404 are ANSWERS.
// Retrying them turns a clear refusal into a slow one, hammers a server that
// already said no, and on 401 can lock an account out.
test('a refusal is returned, never retried', async () => {
  for (const code of [400, 401, 403, 404, 422]) {
    const { fetch, seen } = scripted(status(code))
    const { wait, waited } = recorder()

    const out = await request('https://x/2', {}, { fetch, wait })

    assert.equal(out.status, code)
    assert.equal(seen.length, 1, `${code} was asked ${seen.length} times`)
    assert.deepEqual(waited, [], `${code} caused a wait`)
  }
})

test('a throttle is retried and then succeeds', async () => {
  const { fetch, seen } = scripted(status(429), status(429), status(200))
  const { wait, waited } = recorder()

  const out = await request('https://x/3', {}, { fetch, wait })

  assert.equal(out.status, 200)
  assert.equal(seen.length, 3)
  assert.equal(waited.length, 2, 'one wait before each retry')
})

test('every retryable status is retried, and the list is the whole list', async () => {
  for (const code of RETRYABLE_STATUS) {
    const { fetch, seen } = scripted(status(code), status(200))
    const { wait } = recorder()
    await request('https://x/4', {}, { fetch, wait })
    assert.equal(seen.length, 2, `${code} was not retried`)
  }
  assert.deepEqual([...RETRYABLE_STATUS].sort((a, b) => a - b), [429, 502, 503, 504])
})

// THE SERVER'S OWN NUMBER FIRST. A provider saying when it will serve you again
// is better information than any curve computed here.
test('Retry-After is obeyed in preference to the backoff schedule', async () => {
  const { fetch } = scripted(status(429, { 'retry-after': '2' }), status(200))
  const { wait, waited } = recorder()

  await request('https://x/5', {}, { fetch, wait, backoffMs: 999_999 })

  assert.deepEqual(waited, [2000], 'two seconds, as asked — not the backoff')
})

test('an absurd Retry-After is ignored rather than obeyed', () => {
  // A provider asking for an hour is telling you to fail now and come back
  // later, not to hold a Worker open for an hour.
  assert.equal(retryAfterMs('3600'), undefined)
  assert.equal(retryAfterMs('-5'), undefined)
  assert.equal(retryAfterMs('not a number'), undefined)
  assert.equal(retryAfterMs(null), undefined)
  assert.equal(retryAfterMs('2'), 2000, 'and a reasonable one is taken')
})

test('an HTTP-date Retry-After is read, and one in the past is ignored', () => {
  const now = Date.parse('2027-05-04T07:00:00Z')
  assert.equal(retryAfterMs(new Date(now + 3000).toUTCString(), now), 3000)
  assert.equal(retryAfterMs(new Date(now - 3000).toUTCString(), now), undefined)
  assert.equal(retryAfterMs(new Date(now + 3_600_000).toUTCString(), now), undefined)
})

test('attempts are bounded — the last throttle is returned, not retried forever', async () => {
  const { fetch, seen } = scripted(status(503))
  const { wait, waited } = recorder()

  const out = await request('https://x/6', {}, { attempts: 3, fetch, wait })

  assert.equal(out.status, 503, 'the caller gets the answer rather than an exception')
  assert.equal(seen.length, 3)
  assert.equal(waited.length, 2, 'no wait after the last attempt')
})

test('a network fault is retried, and the last one is thrown', async () => {
  const boom = () => { throw new Error('ECONNRESET') }
  const { fetch, seen } = scripted(boom, boom, status(200))
  const { wait } = recorder()

  const out = await request('https://x/7', {}, { fetch, wait })
  assert.equal(out.status, 200)
  assert.equal(seen.length, 3)

  const { fetch: always } = scripted(boom)
  await assert.rejects(request('https://x/8', {}, { attempts: 2, fetch: always, wait }), /ECONNRESET/)
})

// BOUNDED, ALWAYS. This runs where a request has a wall-clock limit, and an
// unbounded wait there is a failed request that has not admitted it yet.
// A TEST FOR A HANG MUST NOT BE ABLE TO HANG. Without its own timeout this
// one waits forever when the deadline is broken — which is the failure it
// exists to detect, reported as a suite that never finishes rather than as a
// test that fails. The mutation run found that the slow way.
test('a request that never answers is abandoned and named', { timeout: 5_000 }, async () => {
  const hang = async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })

  await assert.rejects(
    request('https://x/9', {}, { attempts: 1, fetch: hang, timeoutMs: 20 }),
    (error: Error) => error instanceof TransportTimeout && /within 20ms/.test(error.message),
  )
})

test('the backoff grows and carries jitter, so a herd does not re-form', () => {
  // Full jitter: the wait is somewhere in [0, base * 2^(n-1)], so two clients
  // throttled together do not return together.
  assert.equal(backoffFor(1, 100, () => 1), 100)
  assert.equal(backoffFor(2, 100, () => 1), 200)
  assert.equal(backoffFor(3, 100, () => 1), 400)
  assert.equal(backoffFor(3, 100, () => 0), 0, 'and the floor is zero, not the ceiling')
})

test('the signal reaches the fetch — a caller can be cancelled', async () => {
  let saw: unknown
  const fetch = async (_url: string, init?: RequestInit) => {
    saw = init?.signal
    return status(200)
  }

  await request('https://x/10', {}, { fetch })
  assert.ok(saw instanceof AbortSignal, 'every attempt carries a signal, or nothing can end it')
})
