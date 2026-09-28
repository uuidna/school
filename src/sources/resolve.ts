import type { PayloadRequest } from 'payload'

import type { SchoolSource, TokenSource } from './types.js'

import { workspaceConfigOf } from '../plugins/google/workspace/index.js'
import { m365ConfigOf } from '../plugins/microsoft/m365/index.js'
import { tenantOf } from '../payload/scope.js'
import { googleWorkspaceSource } from './google/workspace.js'
import { microsoft365Source } from './microsoft/m365.js'
import { payloadSource } from './payload.js'

/**
 * Which system of record answers for this school.
 *
 * The port had two implementations and nothing chose between them, so every
 * tool went on reading Payload directly and a school running on Workspace got
 * an empty answer from a compliance check rather than its own documents. A seam
 * that nothing passes through is a diagram, not an architecture.
 *
 * The choice is the school's, stated on its own record: a tenant that has
 * configured a Workspace is answered from Directory and Drive, and one that has
 * not is answered from Payload. Nothing here guesses — an unconfigured school
 * falls to the local store, which is where its data actually is.
 */

export type ResolveSourceOptions = {
  /**
   * How to obtain a Google access token for this request.
   *
   * Absent, no Workspace source is built even for a school that configured one
   * — reading Directory without a credential is not a degraded answer, it is
   * no answer, and falling back silently would report a school's documents as
   * missing when they are merely unreachable.
   */
  googleToken?: TokenSource
  /** The same, for a school on Microsoft 365. */
  microsoftToken?: TokenSource
}

export type ResolvedSource = {
  /** Why this source was chosen, so an answer can say where it came from. */
  reason: string
  source: SchoolSource
  system: 'google-workspace' | 'microsoft-365' | 'payload'
}

export const resolveSource = async (
  req: PayloadRequest,
  options: ResolveSourceOptions = {},
): Promise<ResolvedSource> => {
  const tenant = await tenantOf(req.payload, req)
  const workspace = tenant ? workspaceConfigOf(tenant) : null
  const microsoft = tenant ? m365ConfigOf(tenant) : null

  if (workspace && options.googleToken) {
    return {
      reason: `this school is served from Google Workspace (${workspace.domains.base})`,
      source: googleWorkspaceSource({
        ...(workspace.calendarId ? { calendarId: workspace.calendarId } : {}),
        classroom: workspace.classroom,
        ...(workspace.documentsFolderId ? { documentsFolderId: workspace.documentsFolderId } : {}),
        domains: workspace.domains,
        roles: workspace.roles,
        token: options.googleToken,
        writablePeople: workspace.writable,
      }),
      system: 'google-workspace',
    }
  }

  if (microsoft && options.microsoftToken) {
    return {
      reason: `this school is served from Microsoft 365 (${microsoft.domains.base})`,
      source: microsoft365Source({
        ...(microsoft.calendarUser ? { calendarUser: microsoft.calendarUser } : {}),
        ...(microsoft.documentsDriveId ? { documentsDriveId: microsoft.documentsDriveId } : {}),
        domains: microsoft.domains,
        education: microsoft.education,
        roles: microsoft.roles,
        token: options.microsoftToken,
        writablePeople: microsoft.writable,
      }),
      system: 'microsoft-365',
    }
  }

  /**
   * Named, because "no credential" and "no configuration" are different
   * faults and only one of them is the school's to fix. A school that
   * configured a vendor and got its own store back is being told about a
   * deployment that did not pass a token, not about records it never kept.
   */
  const configured = [
    ...(workspace ? ['Google Workspace'] : []),
    ...(microsoft ? ['Microsoft 365'] : []),
  ]

  return {
    reason: configured.length
      ? `this school is configured for ${configured.join(' and ')}, but no credential was supplied for this request, so its own store answered`
      : 'this school keeps its records here',
    source: payloadSource(req),
    system: 'payload',
  }
}
