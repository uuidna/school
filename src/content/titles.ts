import type { LocaleCode } from '../i18n/index.js'

import { FORMAT_LABELS, GENERIC_LABELS } from '../i18n/labels.js'
import { LOCALES } from '../i18n/index.js'

/**
 * What a document is called, when the page that links it did not say.
 *
 * A school's site links its statutory documents through whatever words the
 * person writing the page reached for, and those words are very often not the
 * document's name: „Изтегли PDF", „Download", „hier klicken". Ingesting a file
 * under that label gives a register in which nine documents are called
 * „Download" and none of them can be found — twenty of one school's files were
 * about to be titled „Изтегли PDF" before this rule existed.
 *
 * THE JUDGEMENT IS UNIVERSAL AND THE WORDS ARE NOT. Every school has this
 * problem and each has it in its own language, so the words are a table
 * crossed with ray — in i18n/labels.ts, where locale tables live — and the
 * pattern is built from it. Written as one regex, as it first was, the rule
 * worked for exactly one school and silently did nothing for the next, which
 * is worse than not having it because the register would look deliberate.
 */

/**
 * The pattern for a ray, or for all of them when none is named.
 *
 * THE BOUNDARY IS WRITTEN OUT RATHER THAN `\b`, WHICH IS ASCII. `\w` is
 * `[A-Za-z0-9_]`, so after „изтегли" — Cyrillic on the left, a space on the
 * right — JavaScript sees no word boundary and the pattern never matches. That
 * fault cost twenty documents their names, and it is the same one that turned
 * „Учебни планове" into `--------` when an older slugifier met `\w`.
 *
 * Built rather than written: a list and a regex that must agree are two things
 * to keep in step, and the regex is the one nobody re-reads.
 */
export const genericLabel = (locale?: LocaleCode): RegExp => {
  const words = locale
    ? GENERIC_LABELS[locale]
    : LOCALES.flatMap((ray) => GENERIC_LABELS[ray.code as LocaleCode])
  const all = [...new Set([...words, ...FORMAT_LABELS])]

  /*
   * A boundary is a claim that words are separated, and Chinese does not
   * separate them. „下载文件" is „download" followed immediately by „file", so
   * the lookahead that rescues „изтегли PDF" rejects the one label a Chinese
   * page would actually use — the rule would have been silently inert for one
   * of the seven rays, which is the failure this table exists to prevent.
   *
   * So the boundary applies to the scripts that have one. Han is matched as a
   * prefix, which is what a reader of it would do.
   */
  const HAN = /\p{Script=Han}/u
  const spaced = all.filter((word) => !HAN.test(word))
  const unspaced = all.filter((word) => HAN.test(word))

  const branches = [
    spaced.length > 0 ? `(?:${spaced.join('|')})(?![\\p{L}\\p{N}])` : '',
    unspaced.length > 0 ? `(?:${unspaced.join('|')})` : '',
  ].filter(Boolean)

  return new RegExp(`^(?:${branches.join('|')})`, 'iu')
}

/** A title long enough to be the document rather than describe it. */
const MAX_TITLE = 160

/**
 * The words, without the decoration a page puts around a link.
 *
 * Leading and trailing emoji, brackets and bullets are what a site uses to
 * draw attention to a download; in a document title they are noise, and one of
 * them is a `]` left over from a markdown link. A very long title is cut at a
 * word so the admin list stays readable.
 *
 * Script-neutral by construction: it keeps letters and numbers in any script
 * and strips what is neither, so it does not favour the alphabet whoever wrote
 * it happened to use.
 */
export const tidyTitle = (text: string, max = MAX_TITLE): string => {
  const collapsed = text
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}.)]+$/u, '')
    .trim()

  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/**
 * An address rather than a name: `/files/daa064_fa36….pdf`, or a bare URL.
 *
 * A site sometimes uses the path itself as a link's visible text, and such a
 * label is not generic and is comfortably longer than three characters — so it
 * walks straight past the rule above. Two of one school's 2019 budget
 * documents were ingested titled after their own file path, and the budget
 * page showed that path to readers as the words to click.
 */
const PATH_LIKE = /^(https?:\/\/|\/|[\w.-]+\/)|\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|webp)$/i

export const isAddress = (text: string): boolean => PATH_LIKE.test(text)

/** Whether a piece of text points at a document instead of naming it. */
export const isGenericLabel = (text: string, locale?: LocaleCode): boolean =>
  genericLabel(locale).test(text.trim())

/**
 * Whether a piece of text can serve as a document's title: not an address, not
 * a word that names no document, and long enough to be a name.
 */
export const names = (text: string, locale?: LocaleCode): boolean =>
  Boolean(text) && !isGenericLabel(text, locale) && !isAddress(text) && text.trim().length > 3

/**
 * The link's own words, unless they name no document. Then the last heading
 * that did — and if the link is the first thing on the page, the page itself:
 * „Кликнете тук, за да прочетете вестника" is the opening line of the post
 * announcing a school newspaper, so the post's own title is what the file
 * should be called.
 */
export const chooseTitle = (parts: {
  above?: string
  locale?: LocaleCode
  own?: string
  page?: string
}): string => {
  const { above = '', locale, own = '', page = '' } = parts
  if (names(own, locale)) return own
  if (names(above, locale)) return above
  return tidyTitle(page) || own
}
