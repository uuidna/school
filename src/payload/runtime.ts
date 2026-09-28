/**
 * What this package requires of a RUNTIME it does not own.
 *
 * `src/payload/schema.ts` opens by saying that a requirement nobody computes is
 * a requirement nobody meets, and then computes what this package needs of the
 * host's *schema*. This file is the same law applied one layer down, to the
 * host's *runtime* — because a guarantee can be broken by the platform as
 * easily as by a config, and the platform fails more quietly.
 *
 * THE CASE THAT PROMPTED IT, reported by the pgtbankya session on 2026-09-21
 * and verified here as far as a machine without Cloudflare can verify it:
 *
 * - Payload 3.90.0 raised password hashing from 25,000 to 600,000 PBKDF2
 *   iterations. Confirmed in the installed build: `currentPasswordHashIterations
 *   = 600000` in dist/auth/strategies/local/generatePasswordSaltHash.js.
 * - The number is a module constant. It is not exported, there is no config
 *   option, and the package's `exports` map refuses both a deep import and
 *   `payload/package.json` — all three checked. A host cannot lower it and
 *   cannot read it.
 * - Cloudflare Workers refuse PBKDF2 above 100,000 iterations, deliberately, so
 *   that a request cannot be made arbitrarily expensive. On that runtime no
 *   account can be created and none can log in.
 *
 * NOT VERIFIED HERE: the Workers ceiling itself. It is reported to be enforced
 * in PRODUCTION ONLY — Node, miniflare and `wrangler dev` all accept 600,000,
 * as the probe below confirms on this machine — so a local test cannot see it.
 * That is precisely why this measures rather than asserts: whatever the ceiling
 * is on the runtime actually executing, `pbkdf2Ceiling` reports it.
 *
 * WHY THIS IS NOT A SCHEMA FINDING. Every other requirement this package
 * computes is answered by config the host passes in. This one is answered only
 * by running something. It is kept separate so that no one reads a green
 * schema report as covering it.
 */

/**
 * The iteration counts to probe, smallest first.
 *
 * `LEGACY` is what Payload used up to and including 3.89.0, `CURRENT` what
 * 3.90.0 and later use, and `WORKERS_CAP` the ceiling Cloudflare is reported to
 * enforce — present so the probe reports a value on the far side of it rather
 * than only "600,000 refused", which would not tell a host whether it had room
 * for 100,000 or for none.
 */
export const PBKDF2_LEGACY = 25_000
export const PBKDF2_CURRENT = 600_000

/**
 * CLEARING THE CEILING IS NOT CLEARING THE REASON FOR IT, and a host reading `pbkdf2Ceiling()` alone would
 * reasonably conclude otherwise: it reports that 600,000 is refused, which reads as an obstacle to route
 * around. pbkdf2Split routes around it correctly. That is not the same as it being safe to.
 *
 * WHAT THE COST ACTUALLY IS, measured on a deployed Worker rather than reasoned about — timed from OUTSIDE the
 * request, because Date.now() is clamped inside an isolate and every in-Worker attempt reads 0 ms. Seven
 * samples at each of 0, 25k, 50k, 100k, 200k, 400k and 600k, minimum taken because network noise only ever
 * adds, with a least-squares line putting network and routing into the intercept rather than the slope:
 *
 *   fixed overhead        85 ms
 *   per 100k iterations  301 ms   (3.0 µs per iteration — a host can price any count from this)
 *   600,000 iterations  1805 ms of CPU
 *
 * Linear across two orders of magnitude, so it is the HMAC chain and not something else. (Measured by the
 * pgtbankya deployment, 2026-09-25, on a gated endpoint that was deleted afterwards — an unauthenticated
 * version of it is a denial of service with a polite name.)
 *
 * 1.8 s fits a paid Worker's 30 s ceiling, so the shim WORKS. Two things the number exposes that correctness
 * did not, and both argue against reaching for it:
 *
 *   IT IS NOT CONFINED TO NEW ACCOUNTS. Payload re-hashes opportunistically when a legacy hash logs in
 *   successfully (`shouldUpdatePasswordHash` in authenticate.js, applied inside login.js). With the shim in
 *   place that rehash SUCCEEDS, so the first login migrates the account and every login after it pays the full
 *   1.9 s rather than the 80 ms it pays today — a 24x increase on the login path, permanent, arriving silently
 *   on first use.
 *
 *   THE COST IS SPENT BEFORE THE PASSWORD IS KNOWN TO BE RIGHT. That is what the 100,000 cap is FOR: it makes a
 *   request-bound denial of service harder, and 600,000 is eighteen times it. maxLoginAttempts locks the
 *   ACCOUNT, not the work — the hash is computed in order to decide whether to lock. So an unauthenticated
 *   attacker at a login form spends 1.9 s of a school's CPU per attempt, and the shim is precisely what removes
 *   the platform's protection against that. 100,000 is about 300 ms, which is already a lot for a login and is
 *   presumably why the line is there rather than higher.
 *
 * So pbkdf2Split is the right implementation of the only construction that keeps stored hashes valid, and the
 * day workerd raises the cap it is what lets the shim come out cleanly. It is not a reason to raise the count
 * on a login path today.
 */
export const PBKDF2_WORKER_MS_PER_100K = 301
export const PBKDF2_WORKER_FIXED_MS = 85
const PROBES = [PBKDF2_LEGACY, 100_000, PBKDF2_CURRENT] as const

export type RuntimeFinding = {
  /** highest probed count this runtime accepted, or 0 if it accepted none */
  ceiling: number
  /** what Payload >= 3.90.0 will attempt, which no host can configure down */
  required: number
  reason: string
  requirement: string
  satisfied: boolean
}

/**
 * The highest count in `PROBES` this runtime will actually derive at.
 *
 * Measured, never inferred from a version string: the version is unreadable
 * from inside (the exports map blocks `payload/package.json`), and a runtime is
 * in any case entitled to change its mind between releases. A probe that throws
 * for any reason counts as a refusal at that width and stops the walk — the
 * counts are ascending, so a runtime that refuses N refuses everything above it.
 */
export const pbkdf2Ceiling = async (): Promise<number> => {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) return 0

  let key: CryptoKey
  try {
    key = await subtle.importKey('raw', new TextEncoder().encode('probe'), 'PBKDF2', false, ['deriveBits'])
  } catch {
    // no PBKDF2 at all is a ceiling of zero, not an error to throw at a booting host
    return 0
  }

  let ceiling = 0
  for (const iterations of PROBES) {
    try {
      await subtle.deriveBits({ hash: 'SHA-256', iterations, name: 'PBKDF2', salt: new Uint8Array(16) }, key, 256)
      ceiling = iterations
    } catch {
      break
    }
  }
  return ceiling
}

/**
 * Can this runtime hash a password the way the Payload it is paired with will?
 *
 * The answer names the pin, because "unsatisfied" without a remedy is the same
 * dead end as the `{"errors":[{"message":"Something went wrong."}]}` Payload
 * returns when the derivation fails — a true report that leaves the reader
 * exactly where they were.
 */
export const checkRuntime = async (): Promise<RuntimeFinding> => {
  const ceiling = await pbkdf2Ceiling()
  const satisfied = ceiling >= PBKDF2_CURRENT
  return {
    ceiling,
    reason: satisfied
      ? `PBKDF2 at ${PBKDF2_CURRENT.toLocaleString('en-US')} iterations succeeds here, so password hashing works on any supported Payload`
      : ceiling === 0
        ? 'this runtime derives no PBKDF2 key at all, so no account can be created and none can log in'
        : `this runtime refuses PBKDF2 above ${ceiling.toLocaleString('en-US')} iterations, and Payload >= 3.90.0 hashes at ` +
          `${PBKDF2_CURRENT.toLocaleString('en-US')} — a module constant with no config option, no export and no deep import. ` +
          'Every account creation and every login fails there with "Something went wrong." Pin payload to >=3 <3.90.0, ' +
          `which hashes at ${PBKDF2_LEGACY.toLocaleString('en-US')} and fits under this ceiling.`,
    required: PBKDF2_CURRENT,
    requirement: `PBKDF2-SHA256 at ${PBKDF2_CURRENT.toLocaleString('en-US')} iterations`,
    satisfied,
  }
}
