import type { Config, Plugin } from 'payload'

import type { FairPluginOptions } from './fair/index.js'
import type { CalendarPluginOptions } from './calendar/index.js'
import type { FinancingPluginOptions } from './financing/index.js'
import type { MediaPluginOptions } from './media/index.js'
import type { M365PluginOptions } from './microsoft/m365/index.js'
import type { WorkspacePluginOptions } from './google/workspace/index.js'
import type { RbacPluginOptions } from './rbac/index.js'
import type { VerifyEndpointOptions } from '../ui/endpoints.js'

import { assertSchema } from '../payload/schema.js'
import { mcpEndpoints } from '../mcp/server.js'
import { verifyEndpoints } from '../ui/endpoints.js'
import { calendarPlugin } from './calendar/index.js'
import { fairSelectionPlugin } from './fair/index.js'
import { financingPlugin } from './financing/index.js'
import { googleWorkspacePlugin } from './google/workspace/index.js'
import { mediaPlugin } from './media/index.js'
import { microsoft365Plugin } from './microsoft/m365/index.js'
import { rbacPlugin } from './rbac/index.js'

/**
 * The whole package, wired.
 *
 * Each plugin is usable alone, and a host that wants only the selection trail
 * should take only that. This is for the ordinary case, and it exists mostly
 * for the last line of it: `assertSchema` ran nowhere.
 *
 * That guard reads the host's real config and reports whether the schema meets
 * what these guarantees depend on — a tenant field where TENANT_PATH says one
 * is, a unique index on (tenant, seq) without which two racing draws fork the
 * chain silently. It was written, exported, tested, and then never called, so
 * it protected exactly nothing on a live deployment. Being callable is not
 * being called.
 *
 * It runs at boot and throws, because a school that will not start is
 * recoverable and a trail that forked six months ago is not.
 */

export type SchoolPluginOptions = {
  fair?: FairPluginOptions | false
  financing?: false | FinancingPluginOptions
  /**
   * The school year a self-hosted school keeps itself.
   *
   * On by default because payloadSource reads it: without the collection, a
   * capability the port reports as available fails at runtime.
   */
  calendar?: CalendarPluginOptions | false
  /** Mount the MCP endpoints at /api/mcp. */
  mcp?: boolean
  /**
   * The media library's migration fields.
   *
   * On by default because `school_ingest_images` is on by default, and the
   * tool without the schema stores files it cannot deduplicate — the unique
   * contentHash index is what makes storing one photograph twice impossible
   * rather than merely unlikely. A host that keeps its media somewhere this
   * package should not touch passes false.
   */
  media?: false | MediaPluginOptions
  /**
   * Where a school states its Microsoft 365, alongside where it states its
   * Workspace. On by default for the same reason that one is: a school picks
   * its vendor by filling in the form for it, and a form that is not there is
   * a vendor this package does not support, whatever its adapter can do.
   */
  microsoft?: false | M365PluginOptions
  multiTenant?: boolean
  rbac?: false | RbacPluginOptions
  /** Fail the deployment when the schema cannot support the guarantees. */
  verifySchema?: boolean
  /** The parent-facing verification page. Mounted unless set false. */
  verifyPage?: false | VerifyEndpointOptions
  workspace?: false | WorkspacePluginOptions
}

export const schoolPlugin =
  (options: SchoolPluginOptions = {}): Plugin =>
  async (config) => {
    const shared = { multiTenant: options.multiTenant }

    let next: Config = config

    if (options.fair !== false) {
      next = (await fairSelectionPlugin({ ...shared, ...options.fair })(next)) as Config
    }
    if (options.rbac !== false) {
      next = (await rbacPlugin({ ...shared, ...options.rbac })(next)) as Config
    }
    if (options.financing !== false) {
      next = (await financingPlugin({ ...options.financing })(next)) as Config
    }
    if (options.calendar !== false) {
      next = (await calendarPlugin({ ...shared, ...options.calendar })(next)) as Config
    }
    if (options.media !== false) {
      next = (await mediaPlugin({ ...shared, ...options.media })(next)) as Config
    }
    if (options.microsoft !== false) {
      next = (await microsoft365Plugin({ ...shared, ...options.microsoft })(next)) as Config
    }
    if (options.workspace !== false) {
      next = (await googleWorkspacePlugin({ ...shared, ...options.workspace })(next)) as Config
    }

    if (options.mcp !== false) {
      next = { ...next, endpoints: [...(next.endpoints ?? []), ...mcpEndpoints] }
    }

    // The two pages a family opens. Mounted by default because the audience
    // this work is for — a parent checking a draw, a pupil asking what they
    // could apply for — cannot reach any of the rest of it.
    if (options.verifyPage !== false) {
      next = {
        ...next,
        endpoints: [...(next.endpoints ?? []), ...verifyEndpoints(options.verifyPage ?? {})],
      }
    }

    if (options.verifySchema === false) return next

    // The one line this composition exists for.
    const priorOnInit = next.onInit
    return {
      ...next,
      onInit: async (payload) => {
        await priorOnInit?.(payload)
        assertSchema(payload)
      },
    }
  }
