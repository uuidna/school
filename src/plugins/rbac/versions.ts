import type { AccessChange } from '../../sources/types.js'

/**
 * The access log, derived from Payload's own version history.
 *
 * WHY THERE WAS A COLLECTION AT ALL, and why there need not be. `access-log`
 * held eight fields — action, subject, actor, reason, summary, before, after,
 * tenant — written by an afterChange hook whenever a role moved. Six of those
 * eight are RESTATEMENTS of a document Payload already keeps: it versions every
 * change, so `before` and `after` are two adjacent versions, `subject` is the
 * user's own email, `summary` is those three in a sentence, and `at` is the
 * version's timestamp. Storing them again created a second account of one
 * event, free to disagree with the first — and an append-only rule enforced by
 * collection access, where Payload's version store is immutable by
 * construction.
 *
 * TWO OF THE EIGHT ARE NOT RESTATEMENTS, and they are the two that matter.
 * A version records what the document BECAME; it does not record who changed
 * it or why. Article 5(2) of Regulation (EU) 2016/679 asks the controller to
 * demonstrate WHY a right was given, not merely that it was — so the reason
 * and the actor are written onto the user document before the save, which is
 * what puts them inside the version snapshot. That is the whole trick: the
 * fields travel with the document, so the history keeps them without a second
 * collection to keep.
 *
 * BEFORE AND AFTER ARE DERIVED, NEVER STORED, and that is a strengthening
 * rather than a saving. A stored `before` can disagree with the previous
 * version; a computed one cannot. The pair is read from two adjacent snapshots
 * of the same document, so the log says what the history says by construction.
 */

/** One Payload version row, in the shape `payload.findVersions` returns. */
export type UserVersion = {
  createdAt?: string
  id?: number | string
  parent?: number | string
  updatedAt?: string
  version?: {
    accessChangedBy?: null | string
    accessReason?: null | string
    email?: string
    role?: null | string
  }
}

/** The two fields a version cannot supply on its own. */
export const ACCESS_TRAIL_FIELDS = ['accessChangedBy', 'accessReason'] as const

/**
 * Adjacent versions of one user, newest first, folded into the changes between
 * them.
 *
 * ONLY ROLE CHANGES ARE ACCESS CHANGES. A user editing their own name produces
 * a version and no access change, and reporting it would bury the eleven
 * entries an inspection is looking for under a thousand that answer nothing.
 * The comparison is on `role` and nothing else.
 *
 * The OLDEST version has no predecessor, so the role it carries is where the
 * account started, not a change to it — reporting it as a grant would invent
 * an event. It yields nothing.
 */
export const accessChangesFromVersions = (versions: readonly UserVersion[]): AccessChange[] => {
  // Newest first is how Payload is asked for them; the comparison needs each
  // row beside the one before it in TIME, so the pair is (row, next-in-list).
  const changes: AccessChange[] = []

  for (let i = 0; i < versions.length; i++) {
    const now = versions[i]?.version
    const previous = versions[i + 1]?.version
    if (!now) continue
    // No predecessor in this page: the account's first recorded state, or the
    // edge of the window. Either way there is no change to report here.
    if (!previous) continue

    const after = now.role ?? null
    const before = previous.role ?? null
    if (after === before) continue

    changes.push({
      // 'revoke' when the role falls to the floor, matching what the tools do:
      // dropping to student removes every staff permission.
      action: after === 'student' ? 'revoke' : 'grant',
      actor: now.accessChangedBy ?? 'unknown',
      at: versions[i]?.updatedAt ?? versions[i]?.createdAt ?? '',
      reason: now.accessReason ?? null,
      subject: now.email ?? '',
    })
  }

  return changes
}
