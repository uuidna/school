/**
 * @uuidna/school — a school, as a package.
 *
 * What every school shares, for whatever domain it is asked to serve: the
 * duties its law imposes, the roles that decide who may see a pupil's record,
 * a selection nobody can rig, and an audit trail nobody can quietly edit.
 *
 * What differs between schools is data, not code — a jurisdiction pack for the
 * legal system and a specialty pack for the kind of school. A second school is
 * a configuration.
 */

export * from './access/roles.js'
export * from './fair/chain.js'
export * from './fair/merkle.js'
export * from './fair/draw.js'
export * from './mcp/registry.js'
export * from './i18n/index.js'
export * from './i18n/admin.js'
export * from './packs/index.js'
export * from './payload/findAll.js'
export * from './payload/schema.js'
export * from './payload/testing.js'
export * from './payload/host.js'
export * from './payload/runtime.js'
export * from './payload/pbkdf2.js'

// WHAT THIS BUILD IS. A `file:` consumer has no registry version and no integrity hash to pin; this is the
// package's own answer, so a school checks one line against ours instead of hashing our dist itself.
export * from './identity.js'

// TRANSCRIPTION — an unstructured artefact read into CANDIDATE structure, which something deterministic then
// verifies. Vendor-neutral by construction: Gemini is one provider and the self-hosted path is another.
export * from './sources/transcribe.js'

// A TOOL THAT REPORTS SUCCESS AS AN ABSENCE MUST FIRST ASSERT THAT IT LOOKED — found six times across two
// repositories in one day, by two people, neither recognising it in the other's tree until it was named.
export * from './evidence.js'
export * from './mcp/discovery.js'
export * from './plugins/rbac/versions.js'
export * from './media/ingest.js'
export * from './payload/scope.js'
export * from './payload/groups.js'
export * from './content/titles.js'
export * from './content/lexical.js'
export * from './content/repairs.js'
export * from './content/injection.js'
export * from './sources/resolve.js'
export * from './sources/payload.js'
export * from './sources/roster.js'
export * from './sources/untrusted.js'
export * from './sources/transport.js'
export * from './sources/token.js'
export * from './sources/types.js'
export * from './financing/assess.js'
export * from './financing/provenance.js'
export * from './labs/index.js'
export * from './labs/nature.js'
export * from './labs/spacetime.js'
export * from './financing/eu.js'
export * from './financing/themes.js'
export * from './financing/national.js'
export * from './financing/readiness.js'
export * from './financing/types.js'
export * from './plugins/index.js'

// WHAT A SCHOOL LOOKS LIKE TO A MACHINE THAT IS NOT A BROWSER. Its mandated documents are read by
// aggregators, not only parents; schema.org is how 260 of them become enumerable rather than a page of links.
export * from './seo/schema.js'
export * from './plugins/collections.js'
export * from './sources/microsoft/api.js'
export * from './sources/microsoft/m365.js'
export * from './sources/google/api.js'
export * from './ui/endpoints.js'
export * from './ui/discover.js'
export * from './ui/page.js'
export * from './ui/styles.js'
export * from './ui/verifier.js'
export * from './sources/google/identity.js'
export * from './sources/google/workspace.js'
export * from './tenancy.js'
export { slugField, slugify, transliterate } from './slug.js'
export type { SlugStyle } from './slug.js'
