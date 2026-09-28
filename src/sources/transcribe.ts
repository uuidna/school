/**
 * TRANSCRIPTION — turning an unstructured artefact into CANDIDATE structured claims, which something
 * deterministic then verifies. The model proposes; it never decides.
 *
 * WHY THIS AND NOT FORMULA GENERATION. The combinatorial surfaces in this family are ENUMERABLE: given a
 * bounded lattice of exponent vectors, `crossings()` walks every product and ratio and returns all of them,
 * exhaustively and identically on every run. A model asked for candidates over an enumerable space is strictly
 * dominated — it can only return a subset and invent things outside it. There is nothing for it to add there,
 * and wiring one in would replace a complete answer with a plausible one.
 *
 * Where a model is NOT dominated is the step before: a claim that exists only as a scan, a photograph, a PDF or
 * a sentence has to become structure before any of the deterministic machinery can touch it. That step is a
 * reading, it is not enumerable, and it is exactly the step a person otherwise does by hand — 15 equations were
 * read off a plate image by hand to be checked against the SI lattice, and the checking was the cheap half.
 *
 * NOTHING TRANSCRIBED IS BELIEVED. A candidate carries `verified: false` and cannot be made true here; only a
 * verifier the caller supplies can promote it, and the verdict belongs to that verifier. This is the whole
 * safety property: a transcription that nobody checked is data with a provenance note, never a fact.
 *
 * SOVEREIGNTY. No feature may be vendor-only (src/sources/sovereignty.test.ts), so transcription is a capability
 * with PROVIDERS and the self-hosted path is one of them: a school that declines every vendor supplies the
 * structure directly — which is what a person doing it by hand already is. The capability is the same; the
 * labour moves.
 */

/** One claim read out of an artefact, and where in it. */
export interface Unverified<T> {
  /** the structured reading */
  value: T
  /** the artefact text or locator this was read from — so a reader can go and look */
  from: string
  /** ALWAYS false on arrival. Only a verifier promotes a candidate, and only the caller supplies one. */
  verified: false
}

export interface Verified<T> {
  value: T
  from: string
  verified: true
  /** what the verifier decided and why — its words, not the transcriber's */
  because: string
}

export type Reading<T> = Unverified<T> | Verified<T>

/** A transcriber turns one artefact into candidates. It may return none; it may never return a verdict. */
export interface Transcriber<T> {
  readonly provider: string
  transcribe(artefact: string): Promise<Unverified<T>[]>
}

/** A verifier decides. It is deterministic and local by construction — a remote verifier is a second opinion. */
export type Verifier<T> = (value: T) => { ok: boolean; because: string }

export class NoProvider extends Error {
  constructor(provider: string, why: string) {
    super(
      `transcribe: ${provider} is not configured (${why}). A transcriber without its credential returns NOTHING `
      + 'rather than an empty reading: an empty reading is indistinguishable from an artefact that said nothing, '
      + 'and a caller would record "no claims found" where the truth is "nobody looked".',
    )
    this.name = 'NoProvider'
  }
}

/**
 * verify(candidates, verifier) → the promoted and the refused, kept apart.
 *
 * Refusals are RETURNED, never dropped. A transcriber that reads ten claims of which seven fail is reporting
 * something about the artefact, and silently keeping three would present a filtered view as a complete one.
 */
export function verify<T>(
  candidates: readonly Unverified<T>[],
  verifier: Verifier<T>,
): { verified: Verified<T>[]; refused: { candidate: Unverified<T>; because: string }[] } {
  const out: Verified<T>[] = []
  const refused: { candidate: Unverified<T>; because: string }[] = []
  for (const c of candidates) {
    const verdict = verifier(c.value)
    if (verdict.ok) out.push({ value: c.value, from: c.from, verified: true, because: verdict.because })
    else refused.push({ candidate: c, because: verdict.because })
  }
  return { verified: out, refused }
}

/**
 * The self-hosted transcriber: the structure is supplied, because a person read it.
 *
 * This is not a stub standing in for a real one. It is the honest shape of the local path — a school that
 * declines every vendor still transcribes, by having somebody read the artefact — and it is what keeps the
 * capability from being vendor-only. It carries the artefact reference so a supplied reading is as traceable as
 * a generated one.
 */
export const suppliedTranscriber = <T>(readings: readonly { value: T; from: string }[]): Transcriber<T> => ({
  provider: 'supplied',
  transcribe: (artefact: string) =>
    Promise.resolve(
      readings
        .filter((r) => r.from === artefact || artefact === '')
        .map((r) => ({ value: r.value, from: r.from, verified: false as const })),
    ),
})

export interface GeminiConfig {
  /** absent means NOT CONFIGURED, and every call refuses rather than returning nothing */
  apiKey?: string
  model?: string
  fetch?: typeof fetch
  /** turns the model's text into candidates. Supplied by the caller, because only the caller knows the shape. */
  parse: (text: string) => { value: unknown; from: string }[]
}

/**
 * Gemini as ONE provider of the transcription capability.
 *
 * It is deliberately thin: it sends the artefact, takes back text, and hands the text to a parser the CALLER
 * supplies. It does not know what a formula is, and it must not — the moment this file knows, the model's
 * output starts being interpreted here instead of verified by the thing that owns the subject.
 *
 * A MISSING KEY IS A REFUSAL, NOT AN EMPTY RESULT. An empty reading is indistinguishable from an artefact that
 * said nothing, and a caller would record "no claims found" where the truth is "nobody looked".
 */
export const geminiTranscriber = (config: GeminiConfig): Transcriber<unknown> => ({
  provider: 'gemini',
  transcribe: async (artefact: string) => {
    if (!config.apiKey) throw new NoProvider('gemini', 'no apiKey was configured')
    const doFetch = config.fetch ?? globalThis.fetch
    if (!doFetch) throw new NoProvider('gemini', 'this runtime has no fetch')

    const model = config.model ?? 'gemini-2.0-flash'
    const res = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: artefact }] }] }),
      },
    )
    if (!res.ok) throw new NoProvider('gemini', `the API answered ${String(res.status)}`)
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    return config.parse(text).map((r) => ({ value: r.value, from: r.from, verified: false as const }))
  },
})
