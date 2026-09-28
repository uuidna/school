/**
 * Getting a school built and onto Cloudflare.
 *
 * Every school deploys the same way — the same snapshot, the same guard against
 * a second build, the same distinction between a broken change and a bad
 * connection. What differs is which wrangler config names it and which tables a
 * snapshot must match on, and both are arguments.
 */
export * from './builds.js'
export * from './run.js'
export * from './snapshot.js'
export * from './stamp.js'
