import type { PayloadRequest } from 'payload'

import type { Receipt } from '../fair/draw.js'
import type { SchoolMcpTool } from './registry.js'

import { classOf, roleOf, STAFF_ROLES } from '../access/roles.js'
import { merkleProof, merkleRoot } from '../fair/merkle.js'
import { verifyResult } from '../fair/draw.js'
import { findAll } from '../payload/findAll.js'
import { failure, json, str } from './registry.js'

/**
 * The draw, shown to the people it concerns.
 *
 * This is the promise the fairness section has carried from the start —
 * "inclusion proofs a parent can verify without being shown every other pupil's
 * draw" — and it had no tool and no access rule until now.
 *
 * Two things are separated here that are usually run together:
 *
 * **Was the draw honest** is recomputable from the revealed seed, the weights
 * and the public message. It needs nobody's name.
 *
 * **Who was selected** is a pupil's personal data, and a separate decision the
 * school makes by publishing the outcome. Until it does, the name is withheld
 * and the parent is told exactly which steps they can still recompute for
 * themselves and which are attested by this server — because the field that
 * would let them recompute the rest is the name itself.
 *
 * That honesty is the point. Saying "verified" while quietly meaning "trust us
 * about three of the five steps" is the kind of claim this package exists not
 * to make.
 */

/**
 * WHAT `seq` IS, where it is read rather than where it is made.
 *
 * It is the draw's POSITION IN THIS SCHOOL'S CHAIN, not a row id and not a
 * count of anything. It runs 1, 2, 3 with no gap, per school, and `linkHash`
 * binds it into every chain link — so the number is part of what is hashed,
 * and a receipt cannot be moved to a different position without breaking
 * every link after it.
 *
 * Which is why a caller may ask for a draw BY seq and get a stable answer:
 * seq 4 is the fourth draw this school ran, this month and next year, whoever
 * else has drawn since. A gap in it is not a bookkeeping quirk to be tidied —
 * it is the shape a missing receipt leaves, and `verifyChain` refuses a trail
 * that has one.
 *
 * Explained here because it was explained in chain.ts, in the plugin that
 * ships the column, and in seven languages beside the field a registrar
 * reads — and nowhere on the path a parent's page actually travels, which
 * uses the number thirteen times.
 */
type DrawRow = {
  chainHash?: null | string
  class?: null | string
  hmac?: null | string
  id: number | string
  outcomePublished?: boolean | null
  prevHash?: null | string
  receipt?: Receipt
  serverSeed?: null | string
  seq?: null | number
}

/** The receipt minus the one field that names a child. */
const withoutOutcome = (receipt: Receipt) => {
  const { selectedValue: _withheld, ...rest } = receipt
  return rest
}

/**
 * Every leaf in this school's trail, read past the class gate on purpose.
 *
 * An inclusion proof exists precisely so that one leaf can be shown to belong
 * to a set without the set being disclosed. Building it requires the leaves;
 * what leaves this function is a path of hashes. Returning the other receipts
 * would defeat the mechanism — returning their hashes is the mechanism.
 */
const allLeaves = async (req: PayloadRequest): Promise<string[]> => {
  const rows = await findAll<DrawRow>(req.payload, {
    collection: 'random-selections',
    // Past the class gate — a proof cannot be built without the leaves — and
    // no further. Confinement to this school is not this function's to apply
    // or to forget; findAll derives it from TENANT_PATH on every read.
    overrideAccess: true,
    req,
    sort: 'seq',
  })

  return rows
    .map((row) => row.receipt?.contentAddress)
    .filter((address): address is string => Boolean(address))
}

export const fairnessMcpTools: SchoolMcpTool[] = [
  {
    name: 'school_verify_class_draw',
    // The audience the addressing exists to serve. Staff may look too; a
    // parent of 12a sees 12a and nothing else, enforced by the collection.
    allowedRoles: ['admin', 'parent', 'registrar', 'student', 'teacher'],
    description:
      "Verify the draws held in a class: recompute each from the revealed seed and show an inclusion proof against the sealed root. Shows only the caller's own class. Whether the draw was honest is recomputable without anybody's name; who was selected is shown only where the school has published the outcome.",
    inputSchema: {
      properties: {
        class: str('Class group, e.g. 12a@students.school.bg. Staff only; others get their own'),
        seq: str('A single draw by its sequence number. Omit for every draw in the class'),
      },
      required: [],
      type: 'object',
    },
    writes: false,
    handler: async (args, req) => {
      const role = roleOf(req.user)
      const isStaff = role !== undefined && STAFF_ROLES.includes(role)
      const own = classOf(req.user)

      // Staff may name a class. Nobody else may: asking for another class is
      // how this would become a way to read every other pupil's draw.
      const target = isStaff ? (args.class ? String(args.class) : own) : own

      if (!target) {
        return failure(
          isStaff
            ? 'Name a class, e.g. class: "12a@students.school.bg".'
            : 'Your account is not linked to a class, so there is no draw here to show you.',
        )
      }
      if (!isStaff && args.class && String(args.class).toLowerCase() !== own) {
        return failure('You may only verify draws held in your own class.')
      }

      const draws = await findAll<DrawRow>(req.payload, {
        collection: 'random-selections',
        req,
        sort: 'seq',
        where: {
          class: { equals: target.toLowerCase() },
          ...(args.seq ? { seq: { equals: Number(args.seq) } } : {}),
        },
      })

      if (!draws.length) return json({ class: target, draws: [], note: 'No draws recorded for this class.' })

      const leaves = await allLeaves(req)
      const root = leaves.length ? await merkleRoot(leaves) : undefined

      const verified = await Promise.all(
        draws.map(async (draw) => {
          const receipt = draw.receipt
          const published = draw.outcomePublished === true

          if (!receipt?.contentAddress) {
            return { reason: 'this draw carries no receipt', seq: draw.seq, verifiable: false }
          }

          // Recomputed here only when the seed has been revealed. Without it
          // nobody can check anything, including this server, and saying so is
          // better than reporting a verification that did not happen.
          const recomputation = draw.serverSeed
            ? await verifyResult({ hmac: draw.hmac, receipt }, draw.serverSeed)
            : undefined

          const inclusion =
            root && leaves.includes(receipt.contentAddress)
              ? await merkleProof(leaves, receipt.contentAddress)
              : undefined

          return {
            chain: { chainHash: draw.chainHash, prevHash: draw.prevHash, seq: draw.seq },
            inclusion: inclusion
              ? { leaf: inclusion.leaf, path: inclusion.path, root: inclusion.root }
              : { proven: false, reason: 'this receipt is not in the current sealed set' },
            outcome: published
              ? { published: true, selected: receipt.selectedValue }
              : {
                  published: false,
                  reason:
                    'The school has not published who was selected. That is a pupil’s personal data and a separate decision from whether the draw was fair — which you can still check below.',
                },
            receipt: published ? receipt : withoutOutcome(receipt),
            seq: draw.seq,
            verifiable: true,
            verification: recomputation ?? {
              reason: 'the server seed has not been revealed, so this draw cannot be recomputed by anyone yet',
              valid: undefined,
            },
            // Honest scope, stated per draw rather than implied once.
            youCanRecompute: published
              ? ['the ticket, from the seed and the public message', 'the selected index, from the weights', 'the receipt’s content address', 'this inclusion proof, against the root']
              : [
                  'the ticket, from the seed and the public message',
                  'the selected index, from the weights',
                  'this inclusion proof, against the root',
                ],
            attestedByThisServer: published
              ? []
              : [
                  'the receipt’s content address — recomputing it needs the selected name, which is withheld',
                ],
          }
        }),
      )

      return json({
        checkedAt: new Date().toISOString(),
        class: target,
        draws: verified,
        howToCheck:
          'Recompute with @uuidna/school: getUnbiasedInt(serverSeed, receipt.message, receipt.totalWeight, receipt.domain) gives the ticket; walk receipt.weights to get the index; verifyInclusion({ leaf, path, root }) checks this draw belongs to the sealed set. None of it requires this server.',
        sealedRoot: root ?? null,
      })
    },
  },
]
