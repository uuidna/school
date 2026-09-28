/**
 * Getting a built school onto Cloudflare, and saying which half went wrong.
 *
 * Three things here were each learned by losing an afternoon:
 *
 *  - IT REFUSES TO START BESIDE ANOTHER BUILD, asking the process table about
 *    programs rather than words. `pgrep -f` matches whole command lines, so a
 *    shell *waiting* for a build — `until ! pgrep -f "next build"` — is itself a
 *    line saying „next build", and the first version of this guard refused a
 *    deploy because somebody in another checkout was watching for a build that
 *    had already ended. See builds.ts.
 *  - IT RETRIES TRANSPORT AND NOTHING ELSE. `D1_ERROR: too many SQL variables`
 *    is a real defect this codebase has had, and retrying it would hide the very
 *    thing a trap test exists to catch.
 *  - IT RETRIES THE SENDING, NOT THE BUILDING. The build output is identical
 *    between attempts, so rebuilding before each upload spent minutes to send
 *    the same bytes again. On a slow uplink that is the difference between three
 *    chances and one.
 *
 * The snapshot, the origin and the commit id used to be three sibling scripts
 * this one spawned with `node`. They are function calls now.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { buildProcesses, PGREP } from './builds.js'
import { snapshot, type SnapshotOptions } from './snapshot.js'
import { buildId, serverUrlFor } from './stamp.js'

/**
 * Failures worth trying again — deliberately narrow, and all about transport.
 *
 * `D1_ERROR` on its own is NOT here, for the reason in the docblock above.
 */
const TRANSIENT = [
  /fetch failed/i,
  /Network connection lost/i,
  /Asset upload failed/i,
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i,
  /\b(?:502|503|504|429)\b.*(?:cloudflare|workers|upload)/i,
]

/** Not transient, not this repository's fault either — say which. */
const CONCURRENT = /Another next build process is already running/i

export type DeployOptions = {
  /** How many times to build, and how many times to send each build. */
  attempts?: number
  /** A wrangler environment, when the school runs more than one. */
  environment?: string
  /** Where the deploy lock lives. */
  lock?: string
  /** Tables the snapshot must match on; see snapshot.ts. */
  snapshot: SnapshotOptions['counted']
  /** The wrangler config the origin is read from. */
  wrangler?: string
}

/** How a deploy ended, for a caller that would rather branch than read stdout. */
export type DeployOutcome =
  | { code: number; reason: 'build-failed' | 'concurrent' | 'deploy-refused' | 'snapshot' | 'transport' }
  | { reason: 'deployed' }

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const capture = (
  command: string,
  args: string[],
  extra: Record<string, string> = {},
): Promise<{ code: number; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...extra }, shell: false })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        output += String(chunk)
        process.stdout.write(chunk)
      })
    }
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })

export const deploy = async (options: DeployOptions): Promise<DeployOutcome> => {
  const attempts = options.attempts ?? 3
  const lock = options.lock ?? '.next/.deploy-lock'
  const wrangler = options.wrangler ?? 'wrangler.jsonc'
  const env = options.environment ? ['--env', options.environment] : []

  const running = buildProcesses(
    execFileSync('sh', ['-c', PGREP], { encoding: 'utf8' }),
    process.pid,
  )
  if (running.length > 0) {
    console.error('a build is already running — wait for it rather than starting a second')
    return { code: 3, reason: 'concurrent' }
  }

  if (existsSync(lock)) {
    const holder = Number(readFileSync(lock, 'utf8').trim())
    if (Number.isFinite(holder) && holder !== process.pid && alive(holder)) {
      console.error(`a deploy is already running (pid ${holder}) — wait for it rather than starting a second`)
      return { code: 3, reason: 'concurrent' }
    }
    // A lock left by a process that is gone is not a lock.
    rmSync(lock, { force: true })
  }
  writeFileSync(lock, String(process.pid))

  try {
    // Once, before the attempts: a retry is retrying the network, not the data.
    try {
      await snapshot({ counted: options.snapshot, environment: options.environment })
    } catch (error) {
      console.error(`\ncould not take a snapshot to build against: ${(error as Error).message}`)
      return { code: 1, reason: 'snapshot' }
    }

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) console.log(`\n── transport failure; attempt ${attempt} of ${attempts} ──\n`)

      const stamped = {
        NEXT_PUBLIC_BUILD_ID: buildId(),
        NEXT_PUBLIC_SERVER_URL: serverUrlFor(wrangler, options.environment),
        SCHOOL_D1_SNAPSHOT: '1',
      }

      const build = await capture('npx', ['opennextjs-cloudflare', 'build', ...env], stamped)
      if (build.code !== 0) {
        if (CONCURRENT.test(build.output)) {
          console.error('\nanother build is already running — this one did nothing; wait and try again')
          return { code: 3, reason: 'concurrent' }
        }
        if (attempt < attempts && TRANSIENT.some((pattern) => pattern.test(build.output))) continue
        console.error('\nbuild failed')
        return { code: build.code, reason: 'build-failed' }
      }

      let sent = { code: 1, output: '' }
      for (let upload = 1; upload <= attempts; upload++) {
        if (upload > 1) {
          console.log(`\n── upload failed; sending the same build again, ${upload} of ${attempts} ──\n`)
        }
        sent = await capture('npx', ['opennextjs-cloudflare', 'deploy', ...env], stamped)
        if (sent.code === 0) return { reason: 'deployed' }
        if (!TRANSIENT.some((pattern) => pattern.test(sent.output))) break
      }

      if (TRANSIENT.some((pattern) => pattern.test(sent.output))) {
        console.error(
          `\ngave up after ${attempts} uploads of the same build, every one a transport failure` +
            ' — the build is fine and the connection is not',
        )
        return { code: sent.code, reason: 'transport' }
      }

      // Anything left is the deploy refusing this build rather than failing to
      // send it — a different thing to be told.
      console.error('\ndeploy failed')
      return { code: sent.code, reason: 'deploy-refused' }
    }

    return { code: 1, reason: 'build-failed' }
  } finally {
    rmSync(lock, { force: true })
  }
}
