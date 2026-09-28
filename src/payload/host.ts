import type { Block, Field, FieldBase } from 'payload'

/**
 * Hosting an idea as a Payload CONFIG rather than as code that encodes one.
 *
 * WHERE THIS STARTED, AND WHERE IT WAS WRONG. A bespoke collection earns its
 * place only when something about it rests on a constraint the STORE must
 * enforce — a unique index, or an access rule narrower than "anyone".
 * `random-selections` passes that test; without a unique index on (tenant, seq)
 * two racing draws fork the chain silently. Moving it to `form-submissions` was
 * tried and refused, because that collection is `create: () => true` by design.
 *
 * The contrapositive is where most ideas live: anything with no such constraint
 * should not have a collection written for it. The first attempt at this file
 * then took that too far in the other direction — it tagged every value as
 * `n:3` or `b:true` and parsed them back, because `form-submissions` stores
 * strings. That was custom logic standing in for a config Payload already has.
 *
 * A BLOCK IS A FIELD SCHEMA, and `BlocksFeature({ blocks })` puts one inside
 * the Lexical editor. Payload's field types carry the typing natively — a
 * `number` field stores a number and reads back a number — so there is nothing
 * to tag, nothing to parse, and no second definition of the shape to drift
 * from the first. What this file produces is the Block: a configuration, which
 * the editor, the admin panel, the REST API, the GraphQL schema and the
 * generated types all read from one place.
 *
 * WHAT IS STILL NOT A CONFIG, and is therefore kept as code: nothing here. The
 * tamper-evidence an idea may want is a field hook, which is also configuration
 * — declared on the field, running wherever Payload runs, rather than at a call
 * site somebody has to remember.
 */

/**
 * What an idea's field may be.
 *
 * A REFERENCE RATHER THAN THE TEXT, wherever the thing referred to is a
 * document this deployment already holds. `relationship` is the field type for
 * it, and the difference is not cosmetic: a copied title goes stale the moment
 * the original is renamed, and nothing in the copy says which of the two is
 * current. A reference has one source, resolves at read time, and a deleted
 * target becomes a visible dangling reference instead of a sentence that is
 * quietly wrong. The same argument as importing a type instead of restating it,
 * one layer down in the data.
 */
export type IdeaFieldKind =
  | 'checkbox'
  | 'date'
  | 'json'
  | 'number'
  | 'relationship'
  | 'text'
  | 'textarea'
  | 'upload'

export type IdeaField = {
  kind: IdeaFieldKind
  name: string
  /** Shown in the admin panel beside the input. */
  label?: string
  required?: boolean
  /**
   * WHO MAY SEE OR CHANGE THIS FIELD — a scope, declared per field rather than
   * per collection. Payload runs these underneath every read and write,
   * whichever door the request came through: REST, GraphQL, the admin panel,
   * the MCP tools. A check written at a call site guards that call site; a
   * field access rule guards the field.
   */
  scope?: NonNullable<FieldBase['access']>
  /**
   * WORK THAT TRAVELS WITH THE FIELD. The five phases Payload offers, declared
   * here rather than performed by whoever remembered to call something:
   * beforeValidate, beforeChange, afterChange, afterRead, beforeDuplicate. A
   * stamp, a normalisation or a derived value belongs in one of them, because
   * then it happens on every path into the store and not only the path that was
   * written first.
   */
  hooks?: NonNullable<FieldBase['hooks']>
  /** Indexed in the database — a query the store answers rather than a scan. */
  index?: boolean
  /** Unique in the database: the one promise a field cannot make in code. */
  unique?: boolean
  defaultValue?: unknown
  /** For `relationship` and `upload`: the collection(s) referred to. */
  to?: string | string[]
  /** For `relationship`: many targets rather than one. */
  many?: boolean
}

/**
 * An idea's shape, as the fields it holds.
 *
 * DECLARED, NOT INFERRED FROM A SAMPLE. Inferring a schema from one example is
 * how a field becomes `text` because the first idea happened to hold "3", and
 * every later number is then a string in the database. The shape is the idea;
 * a sample is one of its values.
 */
export type IdeaShape = {
  fields: IdeaField[]
  /** Block slug — the name the editor, the API and the generated types all use. */
  slug: string
  label?: string
}

/**
 * One field, as Payload declares it.
 *
 * The mapping is the whole translation: there is no encoding step, because a
 * Payload `number` field already stores and returns a number.
 */
const fieldFor = (field: IdeaField): Field => {
  if ((field.kind === 'relationship' || field.kind === 'upload') && field.to === undefined) {
    throw new Error(
      `"${field.name}" is a ${field.kind} and names no target — a reference to nothing is a text field with extra steps`,
    )
  }

  return {
    name: field.name,
    type: field.kind,
    ...(field.to ? { relationTo: field.to } : {}),
    ...(field.many ? { hasMany: true } : {}),
    ...(field.label ? { label: field.label } : {}),
    ...(field.required ? { required: true } : {}),
    ...(field.index ? { index: true } : {}),
    ...(field.unique ? { unique: true } : {}),
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.scope ? { access: field.scope } : {}),
    ...(field.hooks ? { hooks: field.hooks } : {}),
  } as Field
}

/**
 * `ideaBlock(shape)` → a Payload Block.
 *
 * Pass it to `BlocksFeature({ blocks: [ideaBlock(shape)] })` to host the idea
 * inside rich text, or into a `blocks` field to host it on a document. Both
 * are the same configuration reaching two places, which is the point.
 */
export const ideaBlock = (shape: IdeaShape): Block => {
  if (shape.fields.length === 0) {
    throw new Error(`the idea "${shape.slug}" declares no fields — a block with no fields hosts nothing`)
  }
  const names = new Set<string>()
  for (const field of shape.fields) {
    if (names.has(field.name)) {
      throw new Error(`the idea "${shape.slug}" declares "${field.name}" twice — one field, one name, or the later silently wins`)
    }
    names.add(field.name)
  }

  return {
    fields: shape.fields.map(fieldFor),
    slug: shape.slug,
    ...(shape.label ? { labels: { plural: shape.label, singular: shape.label } } : {}),
  } as Block
}

/**
 * The same shape as a plain `blocks` field, for hosting on a document rather
 * than inside prose.
 *
 * One shape, two placements, and neither restates the other — which is what
 * made the first version of this file wrong.
 */
export const ideaField = (name: string, shapes: IdeaShape[]): Field =>
  ({
    name,
    type: 'blocks',
    blocks: shapes.map(ideaBlock),
  }) as Field

/**
 * A batch write, with its failures kept.
 *
 * PAYLOAD ALREADY DOES THE BATCH: `update({ collection, where, data })` touches
 * every matching document in one call, and `delete` the same. There was nothing
 * to convert here — this package loops over no updates, which was measured
 * before this was written rather than assumed.
 *
 * WHAT IS MISSING IS THE HONESTY ABOUT PARTIAL FAILURE. A bulk operation
 * returns `{ docs, errors }`, and a caller reading only `docs` sees a batch that
 * "worked" while some documents were refused — by field access, by validation,
 * by a unique index. For a school that is the difference between "every pupil's
 * record was updated" and "most of them were": one is an answer and the other is
 * a report nobody can act on, and they look identical in the happy path.
 *
 * So this returns both counts and REFUSES to collapse them. Nothing is retried
 * and nothing is rolled back: Payload has no transaction across a bulk write to
 * offer, and pretending otherwise would be the false guarantee this package
 * exists against.
 */
export type BatchOutcome = {
  /** Documents the store accepted. */
  changed: number
  /** Documents it refused, with the reason each gave. */
  refused: { id: unknown; reason: string }[]
  /** True only when nothing was refused. Never true because nothing was tried. */
  complete: boolean
  /** Stated so an empty batch is not read as a successful one. */
  attempted: number
}

type Bulkish = {
  docs?: unknown[]
  errors?: { id?: unknown; message?: string }[]
}

/**
 * Read a Payload bulk result honestly.
 *
 * AN EMPTY BATCH IS NOT A COMPLETE ONE. A `where` that matched nothing returns
 * no docs and no errors, which reads as success — and is the single most likely
 * outcome of a typo in the filter. `attempted` is reported so the caller can
 * tell "all of them" from "none of them", which no other field here
 * distinguishes.
 */
export const batchOutcome = (result: Bulkish): BatchOutcome => {
  const changed = (result.docs ?? []).length
  const refused = (result.errors ?? []).map((error) => ({
    id: error.id,
    reason: error.message ?? 'the store refused it and gave no reason',
  }))

  return {
    attempted: changed + refused.length,
    changed,
    complete: refused.length === 0 && changed > 0,
    refused,
  }
}
