import type { EuLoaderOptions } from './eu.js'

/**
 * Finding the calls a school could take part in, by theme.
 *
 * A school that wants its pupils out in a protected area learning by taking
 * part needs to find the money for it, and the money exists: LIFE funds nature
 * and biodiversity work, and its Strategic Nature Projects are the instrument
 * behind Natura 2000 management. Those calls are in the portal already — what
 * was missing was a way to ask for them without knowing a five-digit framework
 * code.
 *
 * **Every code here was read from the portal, not recalled.** `43252405` was
 * confirmed against the live API: 5,105 records, every one a LIFE call. A
 * framework whose code has not been checked that way does not belong in this
 * table, because a wrong code returns a plausible list of the wrong calls and
 * nothing says so.
 *
 * This finds funding. It does not say a school may do anything, and it is not
 * part of the compliance engine: what a school is allowed to take children out
 * to do is a question for its own law and its own safeguarding rules, and no
 * table of grant identifiers answers it.
 */

/** Framework codes confirmed against the portal's own facet data. */
export const EU_FRAMEWORK = {
  /** LIFE — environment and climate action. Verified: 5,105 records. */
  life: '43252405',
} as const

/**
 * Calls, as the portal identifies them.
 *
 * These are `callIdentifier` values, read from the live API on 2026-09-20.
 * They are not the `identifier` values a listing prints — that field names the
 * *topic*, and the first version of this table was built from what a console
 * log showed rather than from the field being queried. It matched nothing, and
 * one of its entries, `LIFE-2026-SAP-NAT-NAT`, did not exist at all: the
 * portal calls it `LIFE-2026-SAP-NAT-NATURE`.
 *
 * A wrong identifier here returns an empty list, which a school cannot tell
 * from a year with no nature funding in it. That is why the test below drives
 * the loader and asserts what was asked for.
 */
export const EU_THEME = {
  /** Climate adaptation, mitigation and governance. */
  climate: ['LIFE-2026-SAP-CLIMA'],
  /** Circular economy, pollution, environmental governance. */
  environment: ['LIFE-2026-SAP-ENV'],
  /**
   * Nature and biodiversity. Its topics include the Strategic Nature Projects
   * that Natura 2000 sites are managed through.
   */
  nature: ['LIFE-2026-SAP-NAT'],
} as const

export type EuTheme = keyof typeof EU_THEME

/**
 * Loader options narrowed to one theme.
 *
 * Given to `loadEuProgrammes` as-is. A school tracking nature work has no use
 * for every open call in the Union, and paging past them is not a narrower
 * question — only a slower one.
 */
export const byTheme = (theme: EuTheme): Pick<EuLoaderOptions, 'must'> => ({
  must: [{ terms: { callIdentifier: [...EU_THEME[theme]] } }],
})

/** Everything LIFE funds, when a school wants the whole framework. */
export const byFramework = (
  framework: keyof typeof EU_FRAMEWORK,
): Pick<EuLoaderOptions, 'must'> => ({
  must: [{ terms: { frameworkProgramme: [EU_FRAMEWORK[framework]] } }],
})
