import type { SchoolMcpTool } from './registry.js'

import { calendarMcpTools } from './calendar.js'
import { complianceTools } from './compliance.js'
import { contentMcpTools } from './content.js'
import { fairnessMcpTools } from './fairness.js'
import { financingMcpTools } from './financing.js'
import { rbacMcpTools } from './rbac.js'
import { rosterMcpTools } from './roster.js'

/**
 * Being found from the URL alone.
 *
 * The MCP server already describes itself at `GET /api/mcp`. That is discovery
 * for somebody who knows to look there, which is nobody — an agent handed
 * `https://school.uuidna.com` has a hostname and no reason to guess a path
 * under `/api`. So the server was discoverable and not findable, and the two
 * are not the same thing.
 *
 * Two conventions close it, and neither is ours to invent: `/llms.txt` at the
 * root, which agents read for a plain-text account of what a site offers, and
 * `/.well-known/mcp.json`, which names the endpoint in a machine-readable
 * form. Both are served from the deployment's root rather than from a Payload
 * endpoint, because Payload mounts endpoints under `/api` and a well-known URI
 * that is not at the well-known place is not one.
 *
 * COMPUTED FROM THE REGISTRY, because a hand-written manifest is a second
 * account of what this server offers, free to disagree with the first. The
 * count, the names and the roles below are read off the same arrays the RPC
 * door serves — add a tool and the manifest says so without anybody
 * remembering to edit it.
 *
 * WHAT IT DOES NOT PUBLISH: what any particular caller may do. The tool list
 * here is the CATALOGUE — which tools exist and what role each needs — not an
 * entitlement. An anonymous reader learns that a school MCP is here and how to
 * authenticate; it learns nothing about this school's data, and every call
 * still passes the role gate and Payload's collection access underneath.
 */

/** Every tool the RPC door serves, from the same arrays it builds from. */
export const CATALOGUE: SchoolMcpTool[] = [
  ...contentMcpTools,
  ...rbacMcpTools,
  ...complianceTools,
  ...financingMcpTools,
  ...fairnessMcpTools,
  ...calendarMcpTools,
  ...rosterMcpTools,
]

const trimOrigin = (origin: string): string => origin.replace(/\/+$/, '')

export type McpManifest = {
  authentication: { description: string; schemes: string[] }
  endpoint: string
  name: string
  protocol: 'mcp'
  tools: { name: string; roles: string[]; writes: boolean }[]
  transport: 'http'
}

/**
 * `/.well-known/mcp.json` — the endpoint, named where a machine looks for it.
 */
export const mcpManifest = (origin: string, name = 'school'): McpManifest => ({
  authentication: {
    description: 'Bearer token in Authorization, or a Payload session cookie. Every tool also passes a role gate and Payload collection access.',
    schemes: ['bearer', 'cookie'],
  },
  endpoint: `${trimOrigin(origin)}/api/mcp`,
  name,
  protocol: 'mcp',
  // Sorted, so two deployments of the same version publish byte-identical
  // manifests and a difference means a difference.
  tools: [...CATALOGUE]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => ({ name: tool.name, roles: [...tool.allowedRoles].sort(), writes: tool.writes === true })),
  transport: 'http',
})

/**
 * `/llms.txt` — the same facts as prose, for an agent that reads before it calls.
 *
 * Written so the first two lines answer the only questions a stranger has:
 * what is this, and where do I call it.
 */
export const llmsTxt = (origin: string, name = 'school'): string => {
  const base = trimOrigin(origin)
  const writes = CATALOGUE.filter((tool) => tool.writes === true).length
  const lines = [
    `# ${name}`,
    '',
    `> A school served by @uuidna/school. It speaks MCP at ${base}/api/mcp — a JSON-RPC 2.0 endpoint over HTTP.`,
    '',
    '## Using it',
    '',
    `- Endpoint: ${base}/api/mcp (POST, JSON-RPC 2.0)`,
    `- Manifest: ${base}/.well-known/mcp.json`,
    '- Authentication: Bearer token in `Authorization`, or a Payload session cookie.',
    '- `tools/list` returns only the tools your role allows. An unauthenticated caller is told how to authenticate and nothing else.',
    '',
    '## What it offers',
    '',
    `${CATALOGUE.length} tools, ${writes} of which write. Every call passes a role gate, and Payload's collection access runs underneath, so a tool can never return more than the caller could read directly.`,
    '',
    ...[...CATALOGUE]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => `- \`${tool.name}\`${tool.writes ? ' (writes)' : ''} — ${tool.description.split('. ')[0]!.trim()}.`),
    '',
    '## What it will not do',
    '',
    '- No tool creates or deletes an account: creating an identity and erasing a person are acts for a named human, and deletion would destroy the audit trail the law requires be kept.',
    '- Pupils are addressed by class-scoped pseudonymous handles, never by name or address.',
    '- Every role change records a reason, because art. 5(2) of Regulation (EU) 2016/679 requires the controller to demonstrate why a right was given, not merely that it was.',
    '',
  ]
  return lines.join('\n')
}
