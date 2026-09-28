import { test } from 'node:test'
import assert from 'node:assert/strict'

import { geminiTranscriber, NoProvider, suppliedTranscriber, verify, type Unverified } from './transcribe.js'

/** a toy verifier standing for the deterministic checkers this exists to feed */
const evenOnly = (n: unknown) =>
  typeof n === 'number' && n % 2 === 0
    ? { ok: true, because: `${String(n)} is even` }
    : { ok: false, because: `${String(n)} is not even` }

test('a transcription arrives unverified and cannot promote itself', async () => {
  const t = suppliedTranscriber<number>([{ value: 2, from: 'plate.jpg' }])
  const [c] = await t.transcribe('plate.jpg')
  assert.equal(c!.verified, false)
  assert.equal(c!.from, 'plate.jpg')
  // the type says `false` literally, so a transcriber cannot return a verified reading at all
  const asAny = c as unknown as Record<string, unknown>
  assert.equal(asAny.because, undefined, 'a candidate carried a verdict it has no right to')
})

/**
 * REFUSALS ARE RETURNED, NEVER DROPPED. A transcriber reading ten claims of which seven fail is reporting
 * something about the artefact; silently keeping three would present a filtered view as a complete one — which
 * is exactly how a plate of mostly-broken equations would come back looking sound.
 */
test('verification keeps the refused alongside the promoted', () => {
  const candidates: Unverified<number>[] = [2, 3, 4, 5].map((n) => ({ value: n, from: 'x', verified: false }))
  const { verified, refused } = verify(candidates, evenOnly)
  assert.deepEqual(verified.map((v) => v.value), [2, 4])
  assert.deepEqual(refused.map((r) => r.candidate.value), [3, 5])
  assert.equal(verified.length + refused.length, candidates.length, 'a candidate vanished')
})

/** The verdict is the VERIFIER'S words, so a reader can tell what decided and why. */
test('a promoted reading carries the verifier’s reason, not the transcriber’s', () => {
  const { verified } = verify([{ value: 8, from: 'x', verified: false }], evenOnly)
  assert.equal(verified[0]!.because, '8 is even')
  assert.equal(verified[0]!.verified, true)
})

/**
 * A MISSING CREDENTIAL IS A REFUSAL, NOT AN EMPTY RESULT. An empty reading is indistinguishable from an
 * artefact that said nothing, so a caller would record "no claims found" where the truth is "nobody looked".
 * This is the same rule the rest of this package keeps: an absent instrument voids, it does not agree.
 */
test('an unconfigured provider refuses rather than reading nothing', async () => {
  const t = geminiTranscriber({ parse: () => [] })
  await assert.rejects(() => t.transcribe('anything'), NoProvider)
  const withKeyNoFetch = geminiTranscriber({ apiKey: 'k', parse: () => [], fetch: undefined as never })
  await assert.rejects(() => withKeyNoFetch.transcribe('anything'), NoProvider)
})

/** An API that answers badly is a refusal too — not zero readings. */
test('a failing API call refuses rather than reading nothing', async () => {
  const t = geminiTranscriber({
    apiKey: 'k',
    parse: () => [{ value: 1, from: 'x' }],
    fetch: (async () => new Response('nope', { status: 500 })) as never,
  })
  await assert.rejects(() => t.transcribe('artefact'), NoProvider)
})

/** The vendor path and the self-hosted path produce the SAME shape — which is what keeps this vendor-neutral. */
test('gemini and the supplied transcriber return the same shape', async () => {
  const supplied = await suppliedTranscriber<number>([{ value: 7, from: 'a' }]).transcribe('a')
  const gemini = await geminiTranscriber({
    apiKey: 'k',
    parse: () => [{ value: 7, from: 'a' }],
    fetch: (async () => Response.json({ candidates: [{ content: { parts: [{ text: 'seven' }] } }] })) as never,
  }).transcribe('a')
  assert.deepEqual(Object.keys(supplied[0]!).sort(), Object.keys(gemini[0]!).sort())
  assert.equal(gemini[0]!.verified, false, 'a vendor reading arrived pre-verified')
})
