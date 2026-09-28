/**
 * What a content repair actually does, as a function a test can call.
 *
 * Each repair used to be one script: its rule, its walk, its database loop and
 * its logging in a single file with top-level `await` and a `process.exit` at
 * the bottom. Nothing could import it, so nothing could test it, and the only
 * evidence a rule was right was that a dry run over already-repaired content
 * reported zero — which a rule that does nothing at all also reports.
 *
 * So the rules are pure: given one Lexical editor state they change it and say
 * what they changed. The runners belong to whoever has a database.
 *
 * None of this is one school's. A site migrated into Payload from somewhere
 * else arrives with the same wounds whatever language it is in — backslashes
 * the converter should have eaten, a title repeated as the first line of the
 * body, headings that start at h1 because they were a page's only heading.
 */
import { createHash } from 'node:crypto'

import type { LocaleCode } from '../i18n/index.js'
import type { LexicalNode } from './lexical.js'

import { YEAR_SUFFIXES } from '../i18n/labels.js'
import { textOf } from './lexical.js'

/** What a transform changed, by name, so a summary can say which. */
export type Tally = Record<string, number>

export const addTally = (into: Tally, from: Tally): Tally => {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value
  return into
}

export const totalOf = (tally: Tally): number =>
  Object.values(tally).reduce((sum, value) => sum + value, 0)

/* ────────────────────────────  markdown residue  ──────────────────────────── */

/** A line that is markdown syntax rather than words. */
const SYNTAX = /^\s*(#{1,6}(\s|$)|\*{3,}\s*$|-{3,}\s*$|={3,}\s*$)/

/**
 * A backslash escape the converter should have consumed — „\- ученици – 101“
 * on /about-5, „1\. Списък“ on /aktualno-ot-ruo-sofiya, where a reader sees a
 * backslash and can only read it as a typing mistake by the school.
 *
 * `\\` is matched first and left alone: a doubled backslash escapes a real
 * backslash, and resolving it would change what the text says.
 */
const ESCAPE = /\\\\|\\([-*_#[\]()>`+.!])/g

/** Markdown's angle-bracket autolink: `<https://example.com>`. */
const AUTOLINK = /<(https?:\/\/[^>\s]+)>/g

/**
 * Lexical wants a 24-character hex id on a node. Derived from the URL rather
 * than drawn at random, so that two runs over the same content — the live site
 * and a restored backup, say — agree on what they produced.
 */
const idFor = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 24)

/**
 * Splits a text node around the autolinks in it, returning the run of nodes
 * that takes its place. Formatting is carried onto each piece, so a bold
 * sentence stays bold either side of the link.
 */
const linkify = (node: LexicalNode, tally: Tally): LexicalNode[] => {
  const text = String(node.text ?? '')
  const matches = [...text.matchAll(AUTOLINK)]
  if (matches.length === 0) return [node]

  const out: LexicalNode[] = []
  const piece = (part: string) => {
    if (part) out.push({ ...node, text: part })
  }

  let at = 0
  for (const match of matches) {
    const url = match[1]!
    piece(text.slice(at, match.index))
    out.push({
      children: [{ ...node, text: url }],
      direction: null,
      fields: { linkType: 'custom', newTab: true, url },
      format: '',
      id: idFor(url),
      indent: 0,
      type: 'link',
      version: 3,
    })
    at = match.index + match[0].length
  }
  piece(text.slice(at))

  tally.linked = (tally.linked ?? 0) + matches.length
  return out
}

const cleanChildren = (children: LexicalNode[], tally: Tally): LexicalNode[] => {
  const kept: LexicalNode[] = []

  for (const child of children) {
    if (Array.isArray(child.children)) child.children = cleanChildren(child.children, tally)

    if (child.type === 'text' && typeof child.text === 'string') {
      const text = child.text.replace(SYNTAX, '')
      if (text !== child.text) tally.stripped = (tally.stripped ?? 0) + 1

      const plain = text.replace(ESCAPE, (whole, escaped?: string) => escaped ?? whole)
      if (plain !== text) tally.unescaped = (tally.unescaped ?? 0) + 1

      // A text node that was nothing but the marker is dropped rather than left
      // empty — an empty text node renders as a stray space and counts as
      // content, which is how the blank headings below came to survive.
      if (!plain.trim()) continue
      child.text = plain

      // An autolink becomes several nodes, so it is spliced in rather than
      // kept: on /about-5-1 the school's prospectus — Bulgarian and English —
      // was two angle-bracketed addresses that no reader could click.
      kept.push(...linkify(child, tally))
      continue
    }

    // A heading with nothing left in it is a gap in the page and a nameless
    // entry in its outline, where a screen reader says "heading level three"
    // and stops. A paragraph is how Lexical spaces a document and is kept; an
    // empty list item is a deliberate blank bullet often enough to leave be.
    if (child.type === 'heading' && Array.isArray(child.children) && child.children.length === 0) {
      tally.emptied = (tally.emptied ?? 0) + 1
      continue
    }

    kept.push(child)
  }

  return kept
}

/** Removes markdown the migration left as text, and the headings it emptied. */
export const stripMarkdownResidue = (root: LexicalNode): Tally => {
  const tally: Tally = {}
  root.children = cleanChildren(root.children ?? [], tally)
  return tally
}

/* ─────────────────────────────────  outline  ──────────────────────────────── */

/**
 * „2026 година", „2026 г.", „2026" — a label, not a sentence.
 *
 * The suffix is whatever the ray writes after the number, from the locale
 * table; several write nothing, which is why the group is optional rather than
 * required. Written with the Bulgarian suffixes inline, as it first was, this
 * promoted headings for one school and silently left every other school's year
 * labels as body text — a page that looks slightly wrong and reports nothing.
 */
const yearLabel = (locale?: LocaleCode): RegExp => {
  const suffixes: readonly string[] = locale
    ? YEAR_SUFFIXES[locale]
    : Object.values(YEAR_SUFFIXES).flat()
  const escaped = [...new Set(suffixes)].map((word) => word.replace(/\./g, '\\.'))
  const tail = escaped.length > 0 ? `(?:${escaped.join('|')})?` : ''
  return new RegExp(`^\\s*(19|20)\\d{2}\\s*${tail}\\s*$`, 'iu')
}

/**
 * Makes a document's section labels part of its outline.
 *
 * A paragraph whose text is exactly the heading above it is a duplicate and
 * goes. A paragraph whose whole text is a year label is promoted — but only
 * inside a document that already makes year labels headings, and only to the
 * level that document uses, so this can never invent a structure an editor did
 * not choose.
 */
export const promoteYearLabels = (root: LexicalNode, locale?: LocaleCode): Tally => {
  const tally: Tally = {}
  const children = root.children ?? []

  const tag = children.find((node) => node.type === 'heading' && yearLabel(locale).test(textOf(node)))?.tag

  const kept: LexicalNode[] = []
  for (const node of children) {
    const previous = kept[kept.length - 1]
    if (
      node.type === 'paragraph' &&
      previous?.type === 'heading' &&
      textOf(node).trim() &&
      textOf(node).trim() === textOf(previous).trim()
    ) {
      tally.removed = (tally.removed ?? 0) + 1
      continue
    }
    kept.push(node)
  }

  if (tag) {
    for (const node of kept) {
      if (node.type !== 'paragraph' || !yearLabel(locale).test(textOf(node))) continue
      node.type = 'heading'
      node.tag = tag
      tally.promoted = (tally.promoted ?? 0) + 1
    }
  }

  root.children = kept
  return tally
}

/* ────────────────────────────────  headings  ──────────────────────────────── */

/**
 * Removes the document's own title where the body repeats it.
 *
 * The page template already prints the title as the page's h1, so a body that
 * opens with the same words shows it twice: „Галерия / Галерия“, „Седмица на
 * сърцето / Седмица на сърцето“.
 *
 * Only the *opening* heading, and only when nothing but empty nodes precedes
 * it — the converter leaves a blank paragraph above a heading often enough
 * that "first child" would miss most of them, and "any heading matching the
 * title" would delete a section that legitimately repeats it further down.
 */
export const dropLeadingTitle = (root: LexicalNode, title: string): Tally => {
  const children = root.children
  if (!children?.length) return {}

  const index = children.findIndex((child) => child.type === 'heading')
  if (index === -1) return {}

  const preceding = children.slice(0, index).map(textOf).join('').trim()
  if (preceding) return {}

  if (textOf(children[index]!).trim() !== title.trim()) return {}

  children.splice(index, 1)
  return { titleStripped: 1 }
}

/**
 * Demotes an h1 in the body to an h2.
 *
 * A page has one h1 and the template owns it. A second one leaves the document
 * with no main heading in its outline, which is what „each page has exactly one
 * h1“ in audit-ui.ts is watching for.
 */
export const demoteH1s = (root: LexicalNode): Tally => {
  const tally: Tally = {}
  const visit = (node: LexicalNode) => {
    if (node.type === 'heading' && node.tag === 'h1') {
      node.tag = 'h2'
      tally.demoted = (tally.demoted ?? 0) + 1
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  return tally
}
