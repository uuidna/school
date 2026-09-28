import { readFileSync } from 'node:fs'

/**
 * WHAT THIS BUILD IS — stated by the package, not guessed by a consumer.
 *
 * @uuidna/school reaches live deployments as a `file:` dependency: no registry version, no integrity hash, and
 * `npm install --install-links` copies whatever was in the working tree at that moment. A consuming school that
 * needs to know WHICH build it is running can only hash the dist itself — a consumer guessing at a producer's
 * build — and if two schools do it, there are two slightly different answers to one question about one package.
 * The package is the only party that knows what its own build produced, so the package answers.
 *
 * THE DIST ADDRESS IS THE VERSION THAT MOVES. `version` is for people and moves when somebody decides it does;
 * `dist` moves when a single shipped byte moves, which is the question a consumer is actually asking. Both
 * travel together: the semver says what was meant, the address says what was shipped.
 *
 * AN UNSTAMPED BUILD REFUSES RATHER THAN GUESSES. Returning a plausible-looking identity for a build nobody
 * stamped is worse than returning none: a consumer would pin against it and the pin would mean nothing. This is
 * the same rule the rest of this package keeps — an absent instrument voids, it does not agree.
 */
export interface Identity {
  name: string
  /** semver, for people */
  version: string
  /** sha256 over every shipped file's digest with its path, sorted — the identity that moves with the bytes */
  dist: string
  files: number
  /** the commit at build time, or null outside a checkout. A CONVENIENCE: a dirty tree has a clean rev. */
  rev: string | null
  /** true when the tree had uncommitted changes, so `rev` does NOT describe this dist */
  dirty: boolean | null
  stampedBy: string
}

/** Thrown rather than returning a shape a caller would pin against. */
export class Unstamped extends Error {
  constructor(why: string) {
    super(
      `@uuidna/school: this build carries no identity (${why}). It was not stamped by scripts/stamp-identity.mjs, `
      + 'so there is nothing to verify against. An identity invented here would be pinnable and meaningless.',
    )
    this.name = 'Unstamped'
  }
}

/**
 * identityOf() → what this build is, or a refusal.
 *
 * Reads the stamp beside the compiled module, so it describes the dist actually loaded rather than whatever
 * source tree happens to be on disk — which is the distinction that matters for a `file:` dependency, where
 * those two are routinely different.
 */
export function identityOf(at: URL = new URL('./identity.json', import.meta.url)): Identity {
  let raw: string
  try {
    raw = readFileSync(at, 'utf8')
  } catch (e) {
    throw new Unstamped(`identity.json is not beside the module: ${String(e)}`)
  }
  let parsed: Partial<Identity>
  try {
    parsed = JSON.parse(raw) as Partial<Identity>
  } catch (e) {
    throw new Unstamped(`identity.json did not parse: ${String(e)}`)
  }
  if (typeof parsed.dist !== 'string' || parsed.dist.length === 0) throw new Unstamped('no dist address')
  if (typeof parsed.version !== 'string') throw new Unstamped('no version')
  return parsed as Identity
}

/**
 * identityMatches(expected) → whether this build is the one a consumer pinned.
 *
 * The consumer's whole check, one line. Compares the DIST ADDRESS and not the version, because a version can be
 * republished over different bytes and the address cannot.
 */
export const identityMatches = (expectedDist: string, at?: URL): boolean => {
  try {
    return identityOf(at).dist === expectedDist
  } catch {
    return false   // unstamped is not a match; it is an unanswered question, and a pin must fail closed
  }
}
