import type { JurisdictionPack, SpecialtyPack } from './types.js'

import { JURISDICTIONS } from './bg.js'
import { SPECIALTIES } from './specialties.js'

export * from './types.js'
export { JURISDICTIONS, SPECIALTIES }

/**
 * The jurisdiction this deployment answers to.
 *
 * Read from `SCHOOL_JURISDICTION`, defaulting to Bulgaria — the only pack that
 * exists. An unknown code is a configuration error worth failing on: a school
 * audited against a legal system that was silently substituted is worse than a
 * school that will not boot.
 */
export const jurisdictionFor = (code = process.env.SCHOOL_JURISDICTION ?? 'bg'): JurisdictionPack => {
  const pack = JURISDICTIONS[code]
  if (!pack) throw new Error(`Unknown jurisdiction pack: ${code}`)
  return pack
}

export const specialtyFor = (
  code = process.env.SCHOOL_SPECIALTY ?? 'vocational-tourism',
): SpecialtyPack => {
  const pack = SPECIALTIES[code]
  if (!pack) throw new Error(`Unknown specialty pack: ${code}`)
  return pack
}

/** Jurisdiction codes this build can actually audit against. */
export const jurisdictionCodes = (): string[] => Object.keys(JURISDICTIONS)

export type ResolvedJurisdiction = {
  code: string
  pack: JurisdictionPack
  /** Where the code came from. Reported, so an audit never hides which law it used. */
  source: 'default' | 'environment' | 'tenant'
}

/**
 * The law *this school* answers to.
 *
 * Read from the school's own record first, because one deployment can serve
 * schools in different legal systems and a process-wide constant cannot. The
 * environment is the single-school fallback, and the last resort is reported as
 * a default rather than passed off as a decision — a school audited against a
 * legal system nobody chose is the quiet failure this whole engine exists to
 * prevent.
 */
export const resolveJurisdiction = (tenant?: null | { jurisdiction?: unknown }): ResolvedJurisdiction => {
  const fromTenant = typeof tenant?.jurisdiction === 'string' ? tenant.jurisdiction : undefined
  const fromEnv = process.env.SCHOOL_JURISDICTION

  const code = fromTenant ?? fromEnv ?? 'bg'
  const source = fromTenant ? 'tenant' : fromEnv ? 'environment' : 'default'

  const pack = JURISDICTIONS[code]
  if (!pack) {
    throw new Error(
      `Unknown jurisdiction pack: ${code} (from ${source}). This build ships: ${jurisdictionCodes().join(', ')}. ` +
        `Refusing to audit a school against a legal system that was silently substituted.`,
    )
  }

  return { code, pack, source }
}
