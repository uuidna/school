import type { PayloadRequest } from 'payload'

import type { SchoolMcpTool } from './registry.js'

import { resolveSource } from '../sources/resolve.js'
import { json, str } from './registry.js'

/**
 * The school year, and what falls due inside it.
 *
 * A funding deadline means little on its own and a great deal placed against a
 * term: a call closing three days into the summer holiday is a call this
 * school cannot answer, and nothing in the financing tools could say so
 * because they had no notion of when the school is open.
 *
 * Staff only. Term dates are public information, but a school's calendar is
 * not only term dates, and this reads whichever calendar the school pointed at
 * — which may hold anything. A parent-facing version would need the school to
 * designate a calendar it means to publish, and that is a decision for the
 * school rather than a default here.
 */

const isoOr = (value: unknown, fallback: string): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : fallback
}

export const calendarMcpTools: SchoolMcpTool[] = [
  {
    name: 'school_calendar',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: ['calendar'],
    description:
      'The school year as this school keeps it: term boundaries, closures and dates it has recorded. Read from whichever system holds the school’s calendar, and the answer names which.',
    inputSchema: {
      properties: {
        from: str('ISO date. Defaults to today'),
        until: str('ISO date. Defaults to a year out'),
      },
      required: [],
      type: 'object',
    },
    writes: false,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const now = new Date()
      const from = isoOr(args.from, now.toISOString())
      const until = isoOr(args.until, new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString())

      const { reason, source, system } = await resolveSource(req)
      const dates = await source.listCalendar({ from, until })

      return json({
        dates: dates
          .slice()
          .sort((a, b) => (a.starts ?? '').localeCompare(b.starts ?? '')),
        from,
        readFrom: { reason, system },
        until,
      })
    },
  },
  {
    name: 'school_upcoming',
    allowedRoles: ['admin', 'registrar', 'teacher'],
    needs: ['calendar'],
    description:
      'One timeline: the school’s own dates and every recorded financing deadline, in order. Answers the question a deadline alone cannot — whether the school is open when it falls.',
    inputSchema: {
      properties: { until: str('ISO date. Defaults to a year out') },
      required: [],
      type: 'object',
    },
    writes: false,
    handler: async (args: Record<string, unknown>, req: PayloadRequest) => {
      const now = new Date()
      const from = now.toISOString()
      const until = isoOr(args.until, new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString())

      const { reason, source, system } = await resolveSource(req)

      // Deadlines come from the financing tool's own reading, so a programme
      // recorded without provenance is excluded here for the same reason it is
      // excluded there rather than by a second rule that could disagree.
      const { financingMcpTools } = await import('./financing.js')
      const opportunities = financingMcpTools.find(
        (tool) => tool.name === 'school_financing_opportunities',
      )!

      const [dates, funding] = await Promise.all([
        source.listCalendar({ from, until }),
        Promise.resolve(opportunities.handler({}, req)).then(
          (result) => JSON.parse(result.content[0]!.text) as { assessed?: unknown[] },
        ),
      ])

      type Entry = { at: string; kind: 'closes' | 'school'; title: string }

      const entries: Entry[] = [
        ...dates
          .filter((date): date is typeof date & { starts: string } => Boolean(date.starts))
          .map((date) => ({ at: date.starts, kind: 'school' as const, title: date.title })),
        ...((funding.assessed ?? []) as { programme?: { closes?: string; name?: string } }[])
          .filter(
            (entry): entry is { programme: { closes: string; name: string } } =>
              typeof entry.programme?.closes === 'string',
          )
          .map((entry) => ({
            at: entry.programme.closes,
            kind: 'closes' as const,
            title: entry.programme.name ?? '',
          })),
      ]
        .filter((entry) => entry.at >= from && entry.at <= until)
        .sort((a, b) => a.at.localeCompare(b.at))

      return json({
        from,
        readFrom: { reason, system },
        // Counted separately so an empty timeline says which half was empty.
        schoolDates: entries.filter((entry) => entry.kind === 'school').length,
        deadlines: entries.filter((entry) => entry.kind === 'closes').length,
        timeline: entries,
        until,
      })
    },
  },
]
