/**
 * Is a build already running, whoever started it?
 *
 * This has to ask about the *program*, not the words. `pgrep -f` matches the
 * whole command line, so a shell waiting for a build to finish — `until !
 * pgrep -f "next build"` — is itself a line containing „next build", and the
 * first version of this guard refused to deploy because someone, in another
 * checkout, was watching for a build that had already ended. A watcher is not
 * the work. So a candidate counts only if the thing being executed is a build
 * tool; a shell, or a pgrep, that merely mentions one does not.
 *
 * It lives apart from the deploy so it can be tested without deploying.
 */
const A_BUILD = /(?:opennextjs-cloudflare\s+(?:build|deploy)|next\s+build)\b/

/** Shells and process-table queries talk about builds; they are not builds. */
const NOT_THE_WORK = /^(?:-?(?:ba|z|k|c|da)?sh|pgrep|ps|grep|egrep|xargs|tee|watch|timeout|env|sudo)$/

/** How to ask the process table. Paired with {@link buildProcesses} below. */
export const PGREP = "pgrep -fl 'opennextjs-cloudflare|next build' || true"

/** One build found in the process table. */
export type BuildProcess = { argv0: string; full: string; pid: number }

/**
 * The builds in `pgrep -fl` output, excluding `self`.
 *
 * @param table lines of `<pid> <argv...>`
 * @param self  a pid to ignore — this process
 */
export const buildProcesses = (table: string, self: number): BuildProcess[] =>
  table
    .split('\n')
    .map((line) => /^(\d+)\s+(\S+)(.*)$/.exec(line.trim()))
    .filter((match) => match !== null)
    /*
     * argv0 says which program; the whole line says what it is doing. Reading
     * the verb out of `rest` alone missed `node_modules/.bin/next build`, where
     * „next" is the executable and only „build" is an argument — the exact
     * leftover process this guard exists to catch.
     */
    .map((match) => {
      const [, pid, argv0, rest] = match as unknown as [string, string, string, string]
      return {
        argv0: argv0.split('/').pop() ?? '',
        full: `${argv0}${rest}`,
        pid: Number(pid),
      }
    })
    .filter(
      ({ argv0, full, pid }) => pid !== self && !NOT_THE_WORK.test(argv0) && A_BUILD.test(full),
    )
