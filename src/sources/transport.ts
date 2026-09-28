/**
 * The one place a request to somebody else's server is made.
 *
 * WHAT WAS THERE BEFORE. Both adapters called `fetch` once and threw on any
 * non-2xx: no retry, no backoff, no reading of 429, no timeout, no way to
 * cancel. Measured across google/api.ts, google/workspace.ts and
 * microsoft/m365.ts — zero occurrences of each. One throttled response part-way
 * through a directory enumeration failed a whole audit, and a connection that
 * stopped answering had nothing to end it.
 *
 * RETRY ONLY WHAT IS RETRYABLE, which is the half that is easy to get wrong in
 * the dangerous direction. 429, 502, 503 and 504 mean "ask again"; a network
 * fault means the same. 400, 401, 403 and 404 are ANSWERS — retrying them turns
 * a clear refusal into a slow one, hammers a server that already said no, and
 * on 401 can lock an account out. A retry loop that cannot tell those apart is
 * worse than no retry at all.
 *
 * THE SERVER'S OWN NUMBER FIRST. When a response carries `Retry-After`, that is
 * the wait — a provider telling you when it will serve you again is better
 * information than any backoff curve computed here. Only when it is absent does
 * the schedule below apply.
 *
 * BOUNDED, ALWAYS. Every call carries a deadline and every retry schedule has a
 * last attempt: this runs on a platform with a CPU and wall-clock limit, and an
 * unbounded wait there is not patience, it is a failed request that has not
 * admitted it yet.
 */

/** Statuses that mean "ask again". Everything else the server said is its answer. */
export const RETRYABLE_STATUS: readonly number[] = [429, 502, 503, 504]

export type TransportOptions = {
  /** Attempts in total, first included. */
  attempts?: number
  /** Base backoff in ms; doubles per attempt, with jitter. */
  backoffMs?: number
  /**
   * The narrow shape both adapters already declare — url and init in, Response
   * out. Wider than that is not needed here, and `typeof globalThis.fetch`
   * would force every caller to cast a function it already has.
   */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Per-attempt deadline in ms. */
  timeoutMs?: number
  /** Injected so the schedule is testable without waiting. */
  wait?: (ms: number) => Promise<void>
}

const DEFAULTS = { attempts: 4, backoffMs: 250, timeoutMs: 15_000 }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * `Retry-After`, in milliseconds, when the server sent one it means.
 *
 * The header is either seconds or an HTTP date. A value that parses to
 * something absurd — negative, or hours away — is ignored rather than obeyed:
 * a deadline is a deadline, and a provider asking for an hour is telling you to
 * fail now and come back later, not to hold a Worker open.
 */
export const retryAfterMs = (header: null | string, now = Date.now()): number | undefined => {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds >= 0 && seconds <= 60 ? seconds * 1000 : undefined
  const at = Date.parse(header)
  if (Number.isNaN(at)) return undefined
  const ms = at - now
  return ms >= 0 && ms <= 60_000 ? ms : undefined
}

/** Exponential with full jitter, so a thundering herd does not re-form on the retry. */
export const backoffFor = (attempt: number, base: number, random = Math.random): number =>
  Math.round(random() * base * 2 ** (attempt - 1))

export class TransportTimeout extends Error {
  constructor(url: string, ms: number) {
    super(`No answer from ${url} within ${ms}ms`)
    this.name = 'TransportTimeout'
  }
}

/**
 * One request, retried where retrying is the right answer.
 *
 * Returns the Response — including a non-retryable error response, which is the
 * caller's to read. This decides only whether asking again could help.
 */
export const request = async (
  url: string,
  init: RequestInit = {},
  options: TransportOptions = {},
): Promise<Response> => {
  const attempts = options.attempts ?? DEFAULTS.attempts
  const base = options.backoffMs ?? DEFAULTS.backoffMs
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
  const wait = options.wait ?? sleep
  const send = options.fetch ?? (globalThis.fetch as undefined | ((u: string, i?: RequestInit) => Promise<Response>))

  if (!send) throw new Error('No fetch available for this source')

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await send(url, { ...init, signal: controller.signal })

      if (!RETRYABLE_STATUS.includes(response.status) || attempt === attempts) return response

      // The server's own number, when it gave one worth obeying.
      const told = retryAfterMs(response.headers.get('retry-after'))
      await wait(told ?? backoffFor(attempt, base))
      continue
    } catch (error) {
      // An abort is this deadline firing, and it is not a network blip: the
      // attempt is over, but another may still be worth making.
      lastError = controller.signal.aborted ? new TransportTimeout(url, timeoutMs) : error
      if (attempt === attempts) throw lastError
      await wait(backoffFor(attempt, base))
    } finally {
      clearTimeout(timer)
    }
  }

  // Unreachable: the loop returns or throws on its last attempt.
  throw lastError ?? new Error(`Request to ${url} made no attempt`)
}
