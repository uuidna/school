/**
 * Language.
 *
 * `@uuidna/school` is an international school: **English is the default**, and
 * Bulgarian is offered beside it. A school in another country adds its language
 * through its jurisdiction pack — nothing here is specific to either.
 *
 * Which one a visitor gets is decided by their own user agent, from the
 * `Accept-Language` header, and English is what they get when that header says
 * nothing this school can serve. A reader who asked for nothing in particular
 * is not assumed to read Bulgarian.
 *
 * A school may override the default: `jurisdictionFor('bg').defaultLocale` is
 * `bg`, so a Bulgarian school serves Bulgarian first while remaining readable
 * to anyone who asks for English.
 */

export const DEFAULT_LOCALE = 'en'

/**
 * The seven locale rays.
 *
 * Not a list chosen here: these are uuidna's own `DIMENSIONS`, so a school's
 * pages, this package's pupil-facing page, and the kernel's object surface all
 * name the same set. Adding an eighth is a change to that constant, not to
 * this file.
 */
export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'bg', label: 'Български' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' },
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']

const SUPPORTED = new Set<string>(LOCALES.map((locale) => locale.code))

/**
 * Parses `Accept-Language` and returns the best supported match.
 *
 * Quality values are honoured, so `bg;q=0.8, en;q=0.9` yields English, and a
 * regional tag matches its base language, so `bg-BG` yields Bulgarian.
 */
export const localeFromAcceptLanguage = (
  header: null | string | undefined,
  fallback: string = DEFAULT_LOCALE,
): string => {
  if (!header) return fallback

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      const quality = q ? Number.parseFloat(q.trim().slice(2)) : 1
      return { quality: Number.isFinite(quality) ? quality : 0, tag: (tag ?? '').trim().toLowerCase() }
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)

  for (const { tag } of ranked) {
    if (SUPPORTED.has(tag)) return tag
    // `bg-BG` and `en-GB` are the same languages as `bg` and `en`.
    const base = tag.split('-')[0]
    if (base && SUPPORTED.has(base)) return base
    if (tag === '*') return fallback
  }

  return fallback
}

export const localeFromRequest = (
  headers: Headers | { get: (name: string) => null | string },
  fallback: string = DEFAULT_LOCALE,
): string => localeFromAcceptLanguage(headers.get('accept-language'), fallback)

/**
 * Payload's `localization` config for a school.
 *
 * `fallback: true` means a field never left empty in the default language shows
 * through in the other, so a half-translated site reads rather than blanks.
 */
export const schoolLocalization = (defaultLocale: string = DEFAULT_LOCALE) => ({
  defaultLocale,
  fallback: true,
  locales: LOCALES.map((locale) => ({ code: locale.code, label: locale.label })),
})
