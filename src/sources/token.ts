import type { TokenSource } from './types.js'

/**
 * Holding a token for as long as it is good, and no longer.
 *
 * WHAT WAS THERE. `TokenSource` is a function and both adapters called it on
 * every single request — the right shape, and nothing built on it. Nothing knew
 * when a token expired, so a token that lapsed mid-enumeration produced a 401
 * the caller saw as a failed audit rather than as a credential to renew. A
 * thousand-user directory walk asked for a token a thousand times and had no
 * way to notice the one moment it mattered.
 *
 * THE TOKEN OFTEN SAYS WHEN IT DIES. A Microsoft Graph access token is a JWT
 * and carries `exp`; reading it needs no configuration and cannot drift from
 * what the issuer decided. A Google access token is an OPAQUE string and says
 * nothing — so the two are handled differently rather than one rule being
 * imposed on both: the JWT is believed, the opaque one gets a conservative
 * lifetime that is always shorter than the hour Google actually grants.
 *
 * AND A 401 IS STILL NOT RETRIED. The transport refuses to retry a 401 for good
 * reason: it is an answer, and asking the same question with the same rejected
 * credential is noise. What happens here is a DIFFERENT request — same URL, new
 * credential — and exactly one of them. If the second is refused too, the
 * credential is not stale, it is wrong, and repeating that is how an account
 * gets locked.
 */

/** Read at parse time, never trusted for authorisation — only for when to renew. */
const decodeExp = (token: string): number | undefined => {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined
  } catch {
    // A token this cannot parse is not a broken token — it is an opaque one,
    // which is what Google issues. Falling back is the correct answer, not a
    // failure to report.
    return undefined
  }
}

export const expiryOf = (token: string): number | undefined => decodeExp(token)

export type CachedTokenOptions = {
  /** Renew this long before expiry, so a request in flight does not cross it. */
  skewMs?: number
  /** Lifetime assumed for a token that does not say — Google's opaque one. */
  opaqueTtlMs?: number
  now?: () => number
}

/** Google grants an hour; twenty minutes is short enough to be wrong safely. */
const DEFAULTS = { opaqueTtlMs: 20 * 60_000, skewMs: 60_000 }

export type CachedToken = {
  /** Drop what is held, so the next call asks the source. */
  invalidate: () => void
  /** The token to use now, fetching or renewing if needed. */
  get: TokenSource
}

/**
 * Wrap a `TokenSource` so it is asked once per lifetime rather than once per
 * request.
 *
 * Concurrent callers share one in-flight fetch: a directory walk that starts
 * five pages at once must not start five token requests, which is both wasteful
 * and, on a provider that rate-limits the token endpoint, the thing that breaks.
 */
export const cachedToken = (source: TokenSource, options: CachedTokenOptions = {}): CachedToken => {
  const skew = options.skewMs ?? DEFAULTS.skewMs
  const opaqueTtl = options.opaqueTtlMs ?? DEFAULTS.opaqueTtlMs
  const now = options.now ?? Date.now

  let held: undefined | { expiresAt: number; token: string }
  let inFlight: Promise<string> | undefined

  const fetchToken = async (): Promise<string> => {
    const token = await source()
    const stated = expiryOf(token)
    held = { expiresAt: stated ?? now() + opaqueTtl, token }
    return token
  }

  return {
    invalidate: () => {
      held = undefined
      inFlight = undefined
    },
    get: async () => {
      if (held && held.expiresAt - skew > now()) return held.token
      // One fetch, however many callers arrive while it is running.
      inFlight ??= fetchToken().finally(() => { inFlight = undefined })
      return inFlight
    },
  }
}

/**
 * Run a request; if it is refused as unauthorised, renew ONCE and run it again.
 *
 * `send` is given the token to use, so the retry is a genuinely different
 * request rather than the same one repeated. Anything but a 401 is returned
 * untouched — including a 403, which means the credential is understood and not
 * permitted, and no amount of renewing changes that.
 */
export const withFreshToken = async (
  token: CachedToken,
  send: (token: string) => Promise<Response>,
): Promise<Response> => {
  const first = await send(await token.get())
  if (first.status !== 401) return first

  token.invalidate()
  // Exactly one. A second refusal means the credential is wrong rather than
  // stale, and repeating that is how an account gets locked.
  return send(await token.get())
}
