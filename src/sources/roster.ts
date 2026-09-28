import type { ClassRoster, RosterMember, SchoolClass } from './types.js'

import { rosterHashOf } from '../fair/draw.js'
import { canonical, sha256 } from '../fair/hash.js'

/**
 * A class roster, with the children taken out of it.
 *
 * Google Classroom, Microsoft's education API and this package's own store all
 * answer "who is in 12a" with names and addresses. None of the three is wrong
 * to: they are the school's systems, and staff sign into them. What is wrong
 * is carrying that answer out through an agent-callable tool, which is why
 * this is the only way a roster leaves a source here — sealed, in one place,
 * so no adapter can be the one that forgets.
 *
 * The draw is what the roster is for, and the draw never needed names. It
 * needs identifiers it can order and commit to; art. 5(1)(c) then decides the
 * rest, because an identifier that is also an identity is more personal data
 * than the purpose requires.
 *
 * Three properties, each tested:
 *
 * - **stable** — the same member in the same class hashes to the same handle
 *   on every call, so a receipt written last term still verifies this term;
 * - **class-scoped** — the same child in two classes has two unrelated
 *   handles, so two rosters cannot be joined into that child's timetable;
 * - **one-way** — the handle is a digest of an internal id, so it reverses to
 *   a name only for someone who already holds the class list, which is the
 *   school itself.
 *
 * The third of those turns on *which* identifier each adapter passes, and it
 * is the one place this is easy to get wrong while everything still looks
 * right. A school's addressing is public and documented — a pupil is
 * `<class>@students.<domain>` — so a handle keyed on an address is a digest of
 * a guessable string, and anyone with a list of common names can walk it back.
 * Keyed on the store's own id, there is nothing to guess. Nothing in the
 * output distinguishes the two, so each adapter is held to the id by a test
 * that recomputes the handle both ways and requires the address one to be
 * absent.
 *
 * Handles are 128 bits of a SHA-256, not the whole of it. The truncation is
 * safe because a handle is a pseudonym and not the commitment: `rosterHash` is
 * computed over the full ordered list of handles and is not truncated, so what
 * a receipt binds to is a full-strength digest either way.
 */

const DOMAIN = 'uuidna/school/roster/v1'

/**
 * The pseudonym for one member of one class.
 *
 * Exported because a school must be able to recompute it. When a draw lands on
 * a handle, the only way back to a pupil is to run this over the class list —
 * which the school holds and nobody else does. That is the intended asymmetry:
 * reversible inside the school, opaque everywhere else.
 */
export const handleFor = async (classId: string, memberId: string): Promise<string> =>
  (await sha256(canonical([DOMAIN, classId, memberId]))).slice(0, 32)

/**
 * Seals a raw membership list into a roster.
 *
 * Sorted by handle rather than by enrolment order, for two reasons: the
 * commitment must not depend on the order a source happened to page through,
 * and enrolment order is itself information about children — who arrived
 * mid-year, who was added last.
 *
 * Parents are not members of a class. A source that carries them alongside
 * pupils passes `role: 'parent'`-shaped rows; they are dropped here rather
 * than at three call sites, because a parent in the candidate list is a draw
 * that can select an adult.
 */
export const sealRoster = async (
  klass: SchoolClass,
  raw: { id: string; role: 'parent' | 'student' | 'teacher' }[],
): Promise<ClassRoster> => {
  /**
   * A class is a SET, and the sources page through a live one.
   *
   * Classroom and Graph both walk a collection that a registrar may be
   * editing while the walk is happening, so a member enrolled between page
   * one and page two can arrive on both. Left alone, that child appeared
   * twice in the candidate list and drew two tickets out of three where every
   * other pupil drew one out of three — a rigged draw produced by nothing
   * worse than a well-timed enrolment, inside the module whose entire purpose
   * is a draw nobody can rig.
   *
   * Keyed on the handle rather than the source id, so a source that reports
   * one person under two ids does not slip past by spelling them differently.
   * Deduplicating is not dropping data: the input is a multiset spelling of a
   * set, and the counts below are taken from what was actually sealed, so a
   * school comparing them against its own register sees the difference rather
   * than being told a number that quietly disagrees.
   */
  const byHandle = new Map<string, RosterMember>()

  for (const entry of raw) {
    if (entry.role === 'parent' || !entry.id) continue
    const handle = await handleFor(klass.id, entry.id)
    const held = byHandle.get(handle)

    /**
     * WHERE THE TWO COPIES DISAGREE, STAFF WINS — and not because staff
     * matter more.
     *
     * The first draft took whichever copy arrived first, on the reasoning
     * that this kept the result independent of page order. It does the
     * opposite: page order is exactly what decides which copy is first, so a
     * handle arriving once as a pupil and once as a teacher resolved
     * differently depending on how the pages fell. That is a directory fault
     * either way, and the resolution of one must not itself be a coin toss.
     *
     * So it is settled by the roles and not by the order, and it is settled
     * in the direction that cannot rig a draw: a teacher miscounted as a
     * pupil can win a pupil's place, while a pupil miscounted as staff loses
     * a ticket and the counts say so loudly enough for somebody to notice.
     */
    const role = held && held.role !== entry.role ? 'teacher' : entry.role
    byHandle.set(handle, { handle, role })
  }

  const members = [...byHandle.values()]

  members.sort((a, b) => a.handle.localeCompare(b.handle))

  const pupils = members.filter((member) => member.role === 'student')

  return {
    class: {
      ...klass,
      // Counted from the roster that was actually sealed, so the count cannot
      // disagree with the list it summarises.
      students: pupils.length,
      teachers: members.length - pupils.length,
    },
    members,
    // The same commitment `pickWeighted` writes into a receipt, computed by
    // the same function — so a draw over this class and a roster read of it
    // produce the identical value, or one of them is wrong.
    rosterHash: await rosterHashOf(pupils.map((member) => ({ value: member.handle, weight: 1 }))),
  }
}

/**
 * The mirror of `sealRoster`: did THIS class produce THAT commitment?
 *
 * Every other seal in this package has one. A receipt is answered by
 * `verifyResult`, a chain link by `verifyChain`, a sealed root by
 * `verifyInclusion`, a programme's address by `verifyProgramme` — and the
 * roster commitment, which a draw receipt binds itself to, could be produced
 * and never checked. A commitment nobody can open is an assertion wearing a
 * hash.
 *
 * What it settles: a published `rosterHash` is the commitment of this class
 * list and of no other. Swap one pupil, add one, drop one, or hand it a
 * different class's list, and the recomputation parts company — which is what
 * makes "the draw ran over 12a and not some other set" a checkable sentence
 * rather than a promise.
 *
 * Who can run it: the school, which holds the list; an inspector the school
 * hands the list to; and — through `rosterHashOfHandles` below — anyone the
 * roster tool answered, since the handles it returns are the commitment's
 * own inputs and name nobody.
 */
export const verifyRoster = async (
  published: string,
  klass: SchoolClass,
  raw: { id: string; role: 'parent' | 'student' | 'teacher' }[],
): Promise<{ recomputed: string; reason: string; valid: boolean }> => {
  const resealed = await sealRoster(klass, raw)

  return resealed.rosterHash === published
    ? {
        recomputed: resealed.rosterHash,
        reason: `this list of ${resealed.class.students} pupil(s) is the roster that commitment was made over`,
        valid: true,
      }
    : {
        recomputed: resealed.rosterHash,
        reason: `this list commits to ${resealed.rosterHash} and the published commitment is ${published} — a different class, or the same class at a different moment`,
        valid: false,
      }
}

/**
 * The same question asked with handles instead of a class list.
 *
 * The roster tool answers with handles and a commitment; this recomputes the
 * commitment from those handles, so the caller who received them can check
 * the pair against each other without holding any pupil's identity at all.
 * Pupils only: teachers are in the roster and are not candidates, which is
 * the one thing a caller cannot see from the handles alone.
 */
export const rosterHashOfHandles = (handles: string[]): Promise<string> =>
  rosterHashOf(handles.map((handle) => ({ value: handle, weight: 1 })))
