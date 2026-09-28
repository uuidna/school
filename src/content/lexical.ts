/**
 * Reading a Lexical document.
 *
 * Payload stores rich text as a tree of nodes, and everything that inspects a
 * school's content — the audits, the repairs, the search index, the structured
 * data — needs the same four questions answered about it: which editor states
 * a document holds, which nodes are in one, what words a node contains, and
 * what a link points at.
 *
 * Written once per caller, those four answers disagree. This version was
 * already the fourth copy of the walk in one repository when it was folded
 * together; here it is the only one, and the generators mean a caller reads
 * exactly as far as it needs.
 *
 * Nothing here is about schools, and nothing is in any language: it is the
 * shape Payload stores, which is the same shape for every deployment.
 */
export type LexicalNode = {
  [key: string]: unknown
  children?: LexicalNode[]
  /** A link node's own settings; `url` is the one every caller here reads. */
  fields?: { linkType?: string; newTab?: boolean; url?: string }
  tag?: string
  text?: string
  type?: string
}

/** A page's blocks or a post's body: where rich text lives on a document. */
export type Editable = { content?: unknown; layout?: unknown }

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object'

/**
 * The root of every Lexical editor state inside a value, however deeply a
 * block, column or array field has buried it.
 *
 * Descent stops at a root: what is below it is that editor's own tree, and a
 * caller that wants those nodes asks for them with `nodes`.
 */
export function* editorStates(value: unknown): Generator<LexicalNode> {
  if (Array.isArray(value)) {
    for (const item of value) yield* editorStates(item)
    return
  }
  if (!isObject(value)) return

  const root = value.root as LexicalNode | undefined
  if (root && Array.isArray(root.children)) {
    yield root
    return
  }

  for (const nested of Object.values(value)) yield* editorStates(nested)
}

/**
 * Every Lexical node inside a value — a node being anything that names its own
 * `type`. Walks the whole structure, so it finds nodes in editor states and in
 * anything else that happens to hold them.
 */
export function* nodes(value: unknown): Generator<LexicalNode> {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item)
    return
  }
  if (!isObject(value)) return

  if (typeof value.type === 'string') yield value as LexicalNode
  for (const nested of Object.values(value)) yield* nodes(nested)
}

/** Every link node inside a value. */
export function* links(value: unknown): Generator<LexicalNode> {
  for (const node of nodes(value)) if (node.type === 'link') yield node
}

/** The words in a node and everything under it, with no markup between them. */
export const textOf = (node: LexicalNode): string =>
  node.type === 'text' ? String(node.text ?? '') : (node.children ?? []).map(textOf).join('')

/** The same words, with runs of whitespace collapsed. */
export const tidyText = (node: LexicalNode): string => textOf(node).replace(/\s+/g, ' ').trim()

/** The `href` of a link node, if it has one. */
export const urlOf = (node: LexicalNode): null | string =>
  node.type === 'link' && typeof node.fields?.url === 'string' ? node.fields.url : null

/* ─────────────────────────────────  naming  ──────────────────────────────── */

/**
 * „Изтегли PDF“, „Кликнете тук“, „виж“ — a label that names no document.
 *
 * The boundary is written out rather than `\b`, which is ASCII: `\w` is
 * `[A-Za-z0-9_]`, so after „изтегли“ — Cyrillic on the left, a space on the
 * right — JavaScript sees no word boundary and the pattern never matches.
 * Twenty of the school's files were about to be titled „Изтегли PDF“ because
 * of it. It is the same fault that turned „Учебни планове“ into `--------`
 * when the old slugifier met `\w`.
 */
