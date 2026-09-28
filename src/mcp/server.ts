import type { Endpoint, PayloadRequest } from 'payload'

import type { SchoolMcpTool } from './registry.js'

import { roleOf } from '../access/roles.js'
import { resolveSource } from '../sources/resolve.js'
import { calendarMcpTools } from './calendar.js'
import { complianceTools } from './compliance.js'
import { fairnessMcpTools } from './fairness.js'
import { financingMcpTools } from './financing.js'
import { contentMcpTools } from './content.js'
import { rbacMcpTools } from './rbac.js'
import { rosterMcpTools } from './roster.js'
import { failure } from './registry.js'

/**
 * MCP server, served natively on Workers.
 *
 * `@payloadcms/plugin-mcp` routes through `mcp-handler`, which depends on the
 * Node `redis` client for session transport; on the Workers runtime every
 * authenticated request to it throws. The protocol's HTTP binding is small, so
 * it is implemented here instead: JSON-RPC 2.0 over a single POST, stateless,
 * with no session store to run.
 *
 * Two ways to authenticate:
 *
 * - `Authorization: Bearer <MCP_API_KEY>` — the Worker secret, so automation
 *   works on a fresh deployment and revoking is one `wrangler secret delete`;
 * - an ordinary Payload session, which is how a signed-in member of staff gets
 *   exactly the tools their own role allows.
 *
 * Authorisation happens twice on purpose: a tool names the roles that may call
 * it, and Payload's collection access control still runs underneath, so a tool
 * can never return more than the caller could read directly.
 */

const TOOLS: SchoolMcpTool[] = [
  ...contentMcpTools,
  ...rbacMcpTools,
  ...complianceTools,
  ...financingMcpTools,
  ...fairnessMcpTools,
  ...calendarMcpTools,
  ...rosterMcpTools,
]

const PROTOCOL_VERSION = '2025-06-18'

type JsonRpcRequest = {
  id?: number | string
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

const rpcResult = (id: number | string | undefined, result: unknown) =>
  Response.json({ id: id ?? null, jsonrpc: '2.0', result })

const rpcError = (id: number | string | undefined, code: number, message: string, status = 200) =>
  Response.json({ error: { code, message }, id: id ?? null, jsonrpc: '2.0' }, { status })

type Authentication =
  | { authenticated: false }
  | { authenticated: true; label: string; role: string }

/**
 * Compares two secrets without leaking their common prefix through timing.
 * Equal-length compare over the full string, no early exit.
 */
const secretEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The machine credential, or a signed-in user.
 *
 * The key path attaches an identity to the request rather than merely naming a
 * role. Tools now read with `overrideAccess: false`, so Payload's access control
 * runs on every call — and access control asks `req.user`, not this function.
 * A role asserted here with no user behind it would pass the tool's own gate
 * and then be refused by the collection, which is the confusing half of a
 * failure rather than the safe half.
 */
const authenticate = (req: PayloadRequest): Authentication => {
  const configured = process.env.MCP_API_KEY
  const offered = req.headers.get('authorization')
  const presented = offered?.startsWith('Bearer ') ? offered.slice(7) : undefined

  if (configured && presented && secretEquals(configured, presented)) {
    // Not persisted: an identity for the duration of this request only.
    req.user = { ...(req.user ?? {}), email: 'mcp-key@local', role: 'admin' } as never
    return { authenticated: true, label: 'worker-secret', role: 'admin' }
  }

  const role = roleOf(req.user)
  if (req.user && role) {
    const email = 'email' in req.user ? String(req.user.email) : 'user'
    return { authenticated: true, label: email, role }
  }

  return { authenticated: false }
}

const describeTool = (tool: SchoolMcpTool) => ({
  name: tool.name,
  annotations: {
    destructiveHint: false,
    openWorldHint: false,
    readOnlyHint: !tool.writes,
    title: tool.name,
  },
  description: tool.description,
  inputSchema: tool.inputSchema,
})

/**
 * Reads the JSON-RPC body.
 *
 * `req.json()` is not always available or replayable on a Payload request, so
 * the raw text is read when it is not — returning a protocol error rather than
 * letting the Worker fault.
 */
const readBody = async (req: PayloadRequest): Promise<JsonRpcRequest | null> => {
  try {
    if (typeof req.json === 'function') return (await req.json()) as JsonRpcRequest
    if (typeof req.text === 'function') return JSON.parse(await req.text()) as JsonRpcRequest
    return null
  } catch {
    return null
  }
}

const handleRpc = async (req: PayloadRequest): Promise<Response> => {
  const auth = authenticate(req)

  if (!auth.authenticated) {
    return rpcError(undefined, -32001, 'Unauthorized: supply an MCP key or sign in', 401)
  }

  const body = await readBody(req)

  if (!body) return rpcError(undefined, -32700, 'Parse error: expected a JSON-RPC 2.0 body')

  const { id, method, params } = body

  // Two filters, for two different reasons.
  //
  // Role: what this caller may ask. Capability: what this school's system can
  // answer at all — a school on Workspace with no Drive folder configured
  // cannot be checked against its statutory documents, and offering the tool
  // and then failing teaches a client nothing it can act on.
  //
  // Both are applied before the list is shown and again before a call runs, so
  // a tool that was never offered also cannot be invoked by name.
  const { source } = await resolveSource(req)

  const permitted = (tool: SchoolMcpTool) =>
    tool.allowedRoles.length === 0 || tool.allowedRoles.includes(auth.role as never)

  const supported = (tool: SchoolMcpTool) =>
    (tool.needs ?? []).every((capability) => source.capabilities[capability])

  const visible = TOOLS.filter((tool) => permitted(tool) && supported(tool))

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: PROTOCOL_VERSION,
        // The deployment names itself; the package serves whichever school
        // installs it.
        serverInfo: {
          name: process.env.SCHOOL_SLUG ?? 'school',
          title: process.env.SCHOOL_NAME ?? 'School',
          version: '1.0.0',
        },
      })

    case 'notifications/initialized':
      return new Response(null, { status: 202 })

    case 'ping':
      return rpcResult(id, {})

    case 'tools/call': {
      const name = String(params?.name ?? '')
      const tool = TOOLS.find((entry) => entry.name === name)

      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`)

      if (!permitted(tool)) {
        req.payload.logger.warn({ msg: 'mcp tool refused', role: auth.role, tool: name })
        return rpcResult(
          id,
          failure(`Role "${auth.role}" may not call ${name}. Allowed: ${tool.allowedRoles.join(', ')}`),
        )
      }

      if (!supported(tool)) {
        const missing = (tool.needs ?? []).filter((capability) => !source.capabilities[capability])
        return rpcResult(
          id,
          failure(
            `${name} needs this school's records to provide ${missing.join(' and ')}, which its system does not. Nothing was read.`,
          ),
        )
      }

      try {
        const result = await tool.handler((params?.arguments ?? {}) as Record<string, unknown>, req)
        return rpcResult(id, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'tool failed'
        req.payload.logger.error({ err: message, msg: 'mcp tool error', tool: name })
        return rpcResult(id, failure(message))
      }
    }

    case 'tools/list':
      return rpcResult(id, { tools: visible.map(describeTool) })

    default:
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export const mcpEndpoints: Endpoint[] = [
  {
    handler: async (req: PayloadRequest) => {
      try {
        return await handleRpc(req)
      } catch (error) {
        // A fault here would otherwise surface as an opaque Worker 1101.
        const message = error instanceof Error ? error.message : String(error)
        req.payload.logger.error({ err: message, msg: 'mcp request failed' })
        return rpcError(undefined, -32603, `Internal error: ${message}`, 500)
      }
    },
    method: 'post',
    path: '/mcp',
  },
  {
    /** Discovery: what this server is and offers, without a handshake. */
    handler: (req: PayloadRequest) => {
      const auth = authenticate(req)

      return Response.json({
        authentication: 'Authorization: Bearer <MCP_API_KEY>, or a Payload session cookie',
        authenticated: auth.authenticated,
        endpoint: '/api/mcp',
        protocolVersion: PROTOCOL_VERSION,
        server: process.env.SCHOOL_SLUG ?? 'school',
        // The tool list is the caller's own. An anonymous probe learns that a
        // server is here and how to authenticate, not what it can be asked to
        // do — and certainly not which calls write.
        tools: (auth.authenticated
          ? TOOLS.filter(
              (tool) =>
                tool.allowedRoles.length === 0 || tool.allowedRoles.includes(auth.role as never),
            )
          : []
        ).map((tool) => ({
          name: tool.name,
          allowedRoles: tool.allowedRoles,
          description: tool.description,
          writes: tool.writes,
        })),
        transport: 'JSON-RPC 2.0 over HTTP POST (stateless)',
      })
    },
    method: 'get',
    path: '/mcp',
  },
]
