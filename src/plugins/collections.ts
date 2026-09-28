import type { CollectionConfig, Config } from 'payload'

/**
 * Adding a collection to a host that may already have one by that name.
 *
 * Every plugin here appended unconditionally, so a host defining its own
 * `random-selections` — written before this package existed, holding live
 * rows, carrying that school's own fields — received a SECOND definition of
 * the same slug. Measured before this existed: ten collections where eight
 * were meant, `random-selections` and `access-log` defined twice, the host's
 * fields in one copy and the package's in the other.
 *
 * That made `schoolPlugin` adoptable only by a host with none of these
 * collections, which is backwards. A host that already has a selection trail
 * and an access log is a host that has already had the chance to make every
 * mistake `assertSchema` exists to catch; it is the one that most needs the
 * guard, and it was the one that could not take it.
 *
 * THE HOST WINS, AND IS TOLD. Skipping is the only resolution that can be
 * right — two definitions of one slug is not a state Payload can hold, and
 * the host's is the one with the rows in it. What must not happen is the
 * skip being silent: a package whose guarantees now rest on a schema it did
 * not write has to say so, which is what `verifySchema` does with the slugs
 * this records. Deferring quietly is how a package's promise becomes a
 * host's assumption.
 */

/** Slugs this package would have shipped and did not, because the host had them. */
export const deferredSlugs = (config: Config, offered: CollectionConfig[]): string[] => {
  const existing = new Set((config.collections ?? []).map((collection) => collection.slug))
  return offered.filter((collection) => existing.has(collection.slug)).map((c) => c.slug)
}

/**
 * The host's collections, plus the ones it does not already define.
 *
 * Order is kept: a plugin's collections arrive after the host's, as they did
 * before, so nothing that reads the array positionally moves.
 */
export const withCollections = (config: Config, offered: CollectionConfig[]): CollectionConfig[] => {
  const existing = new Set((config.collections ?? []).map((collection) => collection.slug))
  return [
    ...(config.collections ?? []),
    ...offered.filter((collection) => !existing.has(collection.slug)),
  ]
}
