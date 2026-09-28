/**
 * The package as plugins.
 *
 * Each is self-sufficient: it brings the collections its guarantees rest on,
 * the hooks that keep them true, and nothing it does not need. That is a
 * correction rather than a tidy-up — the package used to document a unique
 * index and an append-only log and ship neither, leaving both to whether a
 * host remembered.
 *
 * `googleWorkspacePlugin` is the one that adds no collections, because the
 * school's people and documents already live somewhere and this extends that
 * system instead of standing up a second one.
 */
export * from './calendar/index.js'
export * from './fair/index.js'
export * from './financing/index.js'
export * from './google/workspace/index.js'
export * from './media/index.js'
export * from './microsoft/m365/index.js'
export * from './rbac/index.js'
export * from './composite.js'
