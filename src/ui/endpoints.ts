import type { Endpoint, PayloadRequest } from 'payload'

import { fairnessMcpTools } from '../mcp/fairness.js'
import { financingMcpTools } from '../mcp/financing.js'
import { discoverPageHtml } from './discover.js'
import { verifyPageHtml } from './page.js'

/**
 * Serving the verification page, and the data it checks.
 *
 * The data endpoint runs the same handler `school_verify_class_draw` runs —
 * one code path, so a parent opening a link and an auditor calling the tool
 * are answered from the same reads and the same class confinement. A second
 * implementation here would be a second place for the scoping to be wrong,
 * and this is the one surface an unauthenticated stranger might reach.
 */

export type VerifyEndpointOptions = {
  locale?: 'bg' | 'en'
  /** Mount path for the pupil-facing page. Its data endpoint is this plus `/data`. */
  discoverPath?: string
  /** Mount path. The data endpoint is this plus `/data`. */
  path?: string
  schoolName?: string
}

const verifyTool = () => fairnessMcpTools.find((tool) => tool.name === 'school_verify_class_draw')!
const discoverTool = () =>
  financingMcpTools.find((tool) => tool.name === 'school_researcher_financing')!

/** Headers every page and data endpoint here carries. */
const PAGE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'content-type': 'text/html; charset=utf-8',
  // A third party learns which page was read from the Referer header, and a
  // page address here can name a class.
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
} as const

export const verifyEndpoints = (options: VerifyEndpointOptions = {}): Endpoint[] => {
  const path = options.path ?? '/school/verify'
  const discoverPath = options.discoverPath ?? '/school/discover'

  return [
    {
      handler: (req: PayloadRequest) => {
        const url = new URL(req.url ?? 'http://localhost')

        return new Response(
          verifyPageHtml({
            dataUrl: `/api${path}/data${url.search}`,
            ...(options.locale ? { locale: options.locale } : {}),
            ...(options.schoolName ? { schoolName: options.schoolName } : {}),
          }),
          // One document: its own script and style, fetching only from this
          // origin. Nothing else may run here.
          { headers: PAGE_HEADERS },
        )
      },
      method: 'get',
      path,
    },
    {
      handler: async (req: PayloadRequest) => {
        if (!req.user) {
          return Response.json(
            { error: 'Sign in to see your class’s draws.' },
            { headers: { 'cache-control': 'no-store' }, status: 401 },
          )
        }

        const url = new URL(req.url ?? 'http://localhost')
        const asked = url.searchParams.get('class')

        // The tool decides what this caller may see. Passing the parameter
        // through rather than acting on it is the point: staff may name a
        // class, and for anyone else the tool substitutes their own.
        const result = await verifyTool().handler(asked ? { class: asked } : {}, req)

        if (result.isError) {
          return Response.json(
            { error: result.content[0]?.text ?? 'Refused' },
            { headers: { 'cache-control': 'no-store' }, status: 403 },
          )
        }

        return new Response(result.content[0]?.text ?? '{}', {
          headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        })
      },
      method: 'get',
      path: `${path}/data`,
    },
    {
      handler: (req: PayloadRequest) => {
        const url = new URL(req.url ?? 'http://localhost')

        return new Response(
          discoverPageHtml({
            dataUrl: `/api${discoverPath}/data`,
            ...(options.locale ? { locale: options.locale } : {}),
            ...(options.schoolName ? { schoolName: options.schoolName } : {}),
          }),
          { headers: PAGE_HEADERS },
        )
      },
      method: 'get',
      path: discoverPath,
    },
    {
      handler: async (req: PayloadRequest) => {
        if (!req.user) {
          return Response.json(
            { error: 'Sign in to see what you could apply for.' },
            { headers: { 'cache-control': 'no-store' }, status: 401 },
          )
        }

        const url = new URL(req.url ?? 'http://localhost')

        // Straight from the query into the tool, and no further. The applicant
        // details are assessed and returned; nothing is read about this person
        // and nothing is written.
        const stated: Record<string, unknown> = {}
        for (const key of [
          'guardianConsentAt',
          'guardianConsentBy',
          'isMinor',
          'jurisdiction',
          'region',
          'subjects',
        ]) {
          const value = url.searchParams.get(key)
          if (value) stated[key] = value
        }

        const result = await discoverTool().handler(stated, req)

        if (result.isError) {
          return Response.json(
            { error: result.content[0]?.text ?? 'Refused' },
            { headers: { 'cache-control': 'no-store' }, status: 403 },
          )
        }

        return new Response(result.content[0]?.text ?? '{}', {
          headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
        })
      },
      method: 'get',
      path: `${discoverPath}/data`,
    },
  ]
}
