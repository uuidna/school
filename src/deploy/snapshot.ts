/**
 * A local copy of the real database, for a build to render against.
 *
 * A Next build renders every page and every one of them reads. Through
 * wrangler's remote-binding proxy those reads degrade as the session runs —
 * measured at 3.2s each for the first twenty-five, 9s each by the
 * seventy-fifth, 89 of them in eleven minutes — and a build needing more than
 * that dies with „Network connection lost", which is what a timeout on that
 * path is called. Twelve consecutive build attempts died that way, on a
 * different page each time, which is why it read as flakiness rather than as
 * the one slow dependency it is.
 *
 * One export replaces one round trip per page. The deployed Worker still binds
 * the real D1 — this changes only where the prerender reads, and the snapshot
 * is taken moments before the build, so the HTML is the same HTML.
 *
 * THE COPY IS CHECKED AGAINST WHAT IT COPIED. A dump that half-applies leaves a
 * database that answers every query with a smaller truth, and a site prerendered
 * from it looks fine: fewer documents, shorter listings, no error anywhere. So
 * the row counts are compared per table and a shortfall refuses the build.
 */
import { execFileSync } from 'node:child_process'
import { globSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

export type SnapshotOptions = {
  /** Tables whose emptiness would be invisible on the rendered site. */
  counted: string[]
  /** The D1 binding name, as wrangler knows it. */
  database?: string
  /** Where to write the SQL export. */
  dump?: string
  /** A wrangler environment, when the school runs more than one. */
  environment?: string
  /** miniflare's D1 directory. */
  localState?: string
}

export type SnapshotResult = {
  counts: Record<string, number>
  takenAt: string
}

const DEFAULTS = {
  database: 'D1',
  dump: '.wrangler/snapshot.sql',
  localState: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
}

/**
 * Takes the snapshot, or throws saying why it cannot be trusted.
 *
 * Throws rather than exiting, so a caller can decide — a script exits, a
 * library explains.
 */
export const snapshot = async (options: SnapshotOptions): Promise<SnapshotResult> => {
  const { counted } = options
  const database = options.database ?? DEFAULTS.database
  const dump = options.dump ?? DEFAULTS.dump
  const localState = options.localState ?? DEFAULTS.localState
  const env = options.environment ? ['--env', options.environment] : []

  if (counted.length === 0) {
    throw new Error('nothing to count — a snapshot nobody checks is a copy nobody can trust')
  }

  const wrangler = (args: string[], { quiet = false } = {}): string =>
    execFileSync('npx', ['wrangler', ...args, ...env], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 256,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'inherit'],
    })

  /**
   * Every count in one remote request, rather than one request per table.
   *
   * As subqueries in a single row, not `union all`: D1 refuses six compound
   * SELECT terms with „too many terms in compound SELECT", a limit far below
   * SQLite's own.
   */
  const remoteCounts = (): Record<string, number> => {
    const command =
      'select ' + counted.map((table) => `(select count(*) from "${table}") as "${table}"`).join(', ')
    const output = wrangler(['d1', 'execute', database, '--remote', '--json', '--command', command], {
      quiet: true,
    })
    const parsed = JSON.parse(output.slice(output.indexOf('['))) as { results: Record<string, number>[] }[]
    const row = parsed[0]!.results[0]!
    return Object.fromEntries(counted.map((table) => [table, Number(row[table])]))
  }

  console.log('exporting the real database — one request, not one per page')
  mkdirSync(dirname(dump), { recursive: true })
  wrangler(['d1', 'export', database, '--remote', '--output', dump])

  const remote = remoteCounts()

  /*
   * The local copy is replaced, not merged, and loaded directly rather than
   * through `wrangler d1 execute --file`.
   *
   * The export opens with `PRAGMA defer_foreign_keys=TRUE`, which defers nothing
   * outside a transaction — and wrangler sends the file as a series of batches,
   * so a table whose foreign key points at one created later fails to load.
   * Constraints go off for the load and the result is checked afterwards, which
   * tests more than the import order did.
   */
  console.log('replacing the local copy')
  // Ask wrangler for the local database first, so it creates and names the
  // file: the name is a hash of the database id and not ours to compute.
  wrangler(['d1', 'execute', database, '--local', '--command', 'select 1'], { quiet: true })
  const [file] = globSync(`${localState}/*.sqlite`)
  if (!file) throw new Error('wrangler did not leave a local database to load into')
  for (const stale of globSync(`${localState}/*.sqlite*`)) rmSync(stale, { force: true })

  /*
   * Imported here rather than at the top so an older Node says why:
   * `node:sqlite` needs --experimental-sqlite before 23 and is stable from 24,
   * and a static import fails with ERR_UNKNOWN_BUILTIN_MODULE, naming nothing.
   */
  const { DatabaseSync } = await import('node:sqlite').catch(() => {
    throw new Error(
      `this needs node:sqlite, which Node ${process.versions.node} does not offer unflagged — use Node 24 or newer`,
    )
  })

  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys=OFF')
  db.exec(readFileSync(dump, 'utf8'))

  const local = Object.fromEntries(
    counted.map((table) => {
      try {
        return [table, Number((db.prepare(`select count(*) as n from "${table}"`).get() as { n: number }).n)]
      } catch {
        return [table, null]
      }
    }),
  ) as Record<string, null | number>

  // The integrity the load was allowed to skip, checked rather than assumed.
  const broken = db.prepare('PRAGMA foreign_key_check').all()

  /*
   * Leave a database workerd can open.
   *
   * node:sqlite writes in WAL mode, and a large load leaves a multi-megabyte
   * -wal beside the file. miniflare's SQLite then finds a write-ahead log it has
   * to recover and refuses: „database is locked: SQLITE_BUSY_RECOVERY", which
   * surfaced as an integration suite failing to start — a whole spec file
   * silently not running while the rest passed and the run printed its usual
   * green counts.
   */
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.exec('PRAGMA journal_mode=DELETE')
  db.close()
  for (const leftover of globSync(`${localState}/*.sqlite-wal`)) rmSync(leftover, { force: true })
  for (const leftover of globSync(`${localState}/*.sqlite-shm`)) rmSync(leftover, { force: true })

  const short = counted.filter((table) => local[table] !== remote[table])
  for (const table of counted) {
    console.log(
      `  ${short.includes(table) ? '✗' : '✓'} ${table.padEnd(12)} ` +
        `${local[table] ?? '—'} local / ${remote[table] ?? '—'} real`,
    )
  }

  if (broken.length > 0) {
    throw new Error(`${broken.length} row(s) reference something that is not there`)
  }
  if (short.length > 0) {
    throw new Error(
      `the snapshot does not match what it copied: ${short.join(', ')} — ` +
        'building against it would publish a smaller school with nothing to show it',
    )
  }

  console.log(`\nthe local copy matches the real one across ${counted.length} tables`)
  return { counts: remote, takenAt: new Date().toISOString() }
}
