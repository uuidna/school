import type { PayloadRequest } from 'payload'

import type { SchoolRole } from '../access/roles.js'
import type { SourceCapabilities } from '../sources/types.js'

/**
 * The school's MCP tool registry.
 *
 * Written against plain JSON Schema and a Payload request, with no transport
 * library: `@payloadcms/plugin-mcp` routes through `mcp-handler`, which depends
 * on the Node `redis` client and node-only modules, so its endpoint throws on
 * the Workers runtime for every request that gets past authentication. The
 * protocol itself is small, so it is served directly in `endpoints/mcp.ts`.
 *
 * Each tool declares the roles that may call it. That gate is *in addition to*
 * Payload's collection access control, which still runs underneath: the tool
 * says who may ask, access control says what the answer may contain.
 */

export type McpToolResult = {
  content: { text: string; type: 'text' }[]
  isError?: boolean
}

export type SchoolMcpTool = {
  /** Roles permitted to call this tool. An empty list means any authenticated caller. */
  allowedRoles: SchoolRole[]

  description: string
  handler: (args: Record<string, unknown>, req: PayloadRequest) => McpToolResult | Promise<McpToolResult>
  inputSchema: {
    properties?: Record<string, unknown>
    required?: string[]
    type: 'object'
  }
  name: string
  /**
   * What this tool needs the school's system of record to be able to do.
   *
   * A school on Workspace with no Drive folder configured cannot answer a
   * statutory publication check. Declaring the requirement lets `tools/list`
   * leave the tool out for that school rather than offering it and failing —
   * `SourceCapabilities` says a tool offered and then refused teaches a client
   * nothing it can act on, and that was true of this registry until the
   * requirement was written down.
   *
   * Empty means the tool reads nothing through the port.
   */
  needs?: (keyof SourceCapabilities)[]
  /**
   * Whether the tool changes data. Read-only tools are safe to call
   * speculatively; the rest are announced to clients as destructive hints.
   */
  writes: boolean
}

/**
 * Tools whose handler reaches Payload, and are therefore never public.
 *
 * WHY A MEASURED LIST AND NOT A DECLARATION. The first version of this rule
 * read `needs`, which looked computed and was not: `needs` declares what a tool
 * requires of the SOURCE ADAPTER — the school's system of record, which may be
 * Workspace or M365 — and says nothing about whether the handler touches
 * Payload. Two different axes, and reading one for the other put
 * `school_financing_plan` and `school_verify_class_draw` in the public set
 * while both call `req.payload` directly. A test passed, because it checked the
 * declaration against itself.
 *
 * So this is read off the handlers: `reach.test.ts` scans every MCP source for
 * `req.payload` / `resolveSource(` and fails if a tool reaches Payload and is
 * absent here, or is here and reaches nothing. The list is evidence, and the
 * test is what keeps it evidence.
 *
 * THE SCAN IS TRUSTED IN ONE DIRECTION ONLY. A handler that names `req.payload`
 * demonstrably reaches Payload. A handler that does not may still reach it
 * through a helper, so absence is not proof — which is why the public door must
 * also DENY Payload rather than rely on this being complete. Fail closed, then
 * measure; never measure instead of failing closed.
 */
export const PAYLOAD_REACHING: readonly string[] = [
  'school_access_review',
  'school_calendar',
  'school_check_access',
  'school_class_roster',
  'school_classes',
  'school_data_protection_report',
  'school_fairness_audit',
  'school_financing_plan',
  'school_grant_role',
  'school_list_content',
  'school_load_eu_programmes',
  'school_publish_page',
  'school_publish_post',
  'school_record_national_catalogue',
  'school_record_required_document',
  'school_revoke_access',
  'school_set_navigation',
  'school_upcoming',
  'school_verify_class_draw',
]

/**
 * Public means: reaches no Payload, needs nothing of the school's system, and
 * writes nothing. Three independent refusals, because each has been wrong once.
 */
export const isPublicTool = (tool: Pick<SchoolMcpTool, 'name' | 'needs' | 'writes'>): boolean =>
  !PAYLOAD_REACHING.includes(tool.name) && (tool.needs?.length ?? 0) === 0 && tool.writes !== true

export const text = (value: unknown): McpToolResult => ({
  content: [{ text: String(value), type: 'text' }],
})

export const json = (value: unknown): McpToolResult =>
  text(JSON.stringify(value, null, 2))

export const failure = (message: string): McpToolResult => ({
  content: [{ text: message, type: 'text' }],
  isError: true,
})

/** Short-hands for the schema shapes the tools use. */
export const str = (description: string) => ({ description, type: 'string' as const })
export const enumOf = (values: readonly string[], description: string) => ({
  description,
  enum: [...values],
  type: 'string' as const,
})
