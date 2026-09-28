import type { PayloadRequest } from 'payload'

import type { SchoolMcpTool } from './registry.js'

import { resolveSource } from '../sources/resolve.js'
import { failure, json, str } from './registry.js'

/**
 * The classes, and who is in them — as handles.
 *
 * This is the tool that was held back longest, and the reason was never that
 * it is hard. Google Classroom, Microsoft's education API and this package's
 * own store all answer "who is in 12a" with a list of children's names, and an
 * agent-callable tool that passes that through is a tool that hands a model
 * the roll of a school. art. 5(1)(c) does not forbid reading a roster; it
 * forbids reading more of one than the purpose needs.
 *
 * So the purpose decides the shape. A draw over a class needs a list it can
 * order and commit to. Given handles, it can do all of it: run the draw,
 * publish the receipt, let a parent verify the roster commitment — and the
 * answer to "who won" stays inside the school, where the class list is.
 *
 * What this cannot do, and is not a limitation to be lifted later: name a
 * pupil. There is no argument that turns it on and no role that unlocks it,
 * because a flag that relaxes a protection is the protection's absence with a
 * longer name. Staff who need the register have Classroom, Teams and the admin
 * panel, each with the school's own access control on it. This package does
 * not restate their contents through an agent.
 */

export const rosterMcpTools: SchoolMcpTool[] = [
  {
    name: 'school_classes',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: ['rosters'],
    description:
      'The classes this school teaches, with how many pupils and teachers are in each. Counts only — no names, no addresses. Read from whichever system holds the school’s classes, and the answer names which.',
    inputSchema: { properties: {}, required: [], type: 'object' },
    writes: false,
    handler: async (_args: Record<string, unknown>, req: PayloadRequest) => {
      const { reason, source, system } = await resolveSource(req)
      const classes = await source.listClasses()

      return json({
        classes: classes.slice().sort((a, b) => a.name.localeCompare(b.name)),
        pupils: classes.reduce((total, klass) => total + (klass.students ?? 0), 0),
        readFrom: { reason, system },
        total: classes.length,
      })
    },
  },
  {
    name: 'school_class_roster',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: ['rosters'],
    description:
      'One class as a list of stable pseudonyms, with the roster commitment a draw over that class carries. Contains no names and no addresses, by construction and not by setting: handles are one-way and scoped to their class, so two rosters cannot be joined. Use it to run or check a draw; to see the register, use the school’s own system.',
    inputSchema: {
      properties: {
        class: str('The class, as school_classes reports its id'),
      },
      required: ['class'],
      type: 'object',
    },
    writes: false,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const wanted = String(args.class ?? '').trim()
      if (!wanted) return failure('Name a class — school_classes lists them with their ids')

      const { reason, source, system } = await resolveSource(req)
      const roster = await source.listRoster(wanted)

      if (roster.members.length === 0) {
        // An empty roster and an unknown class look identical downstream, and
        // a draw over nobody is the one that must never quietly proceed.
        return failure(
          `No members in "${wanted}" — check the id against school_classes; a class that exists with nobody in it cannot be drawn over either`,
        )
      }

      return json({
        class: roster.class,
        members: roster.members,
        note: 'Handles, not people. Stable so a receipt stays verifiable, scoped to this class so rosters cannot be joined, and reversible only against the class list the school itself holds.',
        readFrom: { reason, system },
        // The value a receipt from a draw over this class must carry. A
        // parent holding both can check the draw ran over this roster and no
        // other, without being shown anybody in it.
        rosterHash: roster.rosterHash,
      })
    },
  },
]
