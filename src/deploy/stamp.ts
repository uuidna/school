/**
 * What a build is marked with: which school, and which commit.
 *
 * `NEXT_PUBLIC_*` is inlined by Next when it compiles, which is the point and
 * also the trap. The per-school origin exists only as a wrangler var — a
 * RUNTIME value — so a build that takes it from a .env bakes whichever school
 * that file names. The demo once published a sitemap of the first school's URLs
 * that way: nothing failed, nothing logged, and every address it told search
 * engines to index belonged to somebody else.
 *
 * So the build reads the origin from the same place the runtime does.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * JSONC to JSON: strips `//` and block comments, and trailing commas.
 *
 * String-aware in both cases, because a URL contains `//` and would otherwise
 * take the rest of its line with it.
 */
const stripComments = (text: string): string => {
  let out = ''
  let inString = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\') {
        out += text[++index] ?? ''
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++
      out += '\n'
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++
      index++
      out += ' '
      continue
    }
    out += char
  }
  // A comma with nothing but whitespace between it and its closing bracket.
  return out.replace(/,(\s*[}\]])/g, '$1')
}


type WranglerConfig = {
  env?: Record<string, { vars?: Record<string, string> }>
  vars?: Record<string, string>
}

/**
 * The public origin of the school a wrangler config describes.
 *
 * Throws rather than guessing: building without it is how one school's bundle
 * comes to carry another's address.
 */
export const serverUrlFor = (wranglerPath: string, environment?: string): string => {
  const config = JSON.parse(stripComments(readFileSync(wranglerPath, 'utf8'))) as WranglerConfig
  const vars = environment ? config.env?.[environment]?.vars : config.vars
  const url = vars?.NEXT_PUBLIC_SERVER_URL

  if (!url) {
    throw new Error(
      `${wranglerPath} has no NEXT_PUBLIC_SERVER_URL for ${environment ?? 'the default environment'} — ` +
        'building without it would bake in whichever school a .env names',
    )
  }
  return url
}

/**
 * The commit being built, or `unknown` outside a checkout.
 *
 * A dirty tree gets `-dirty`: a build made from uncommitted work corresponds to
 * no commit anybody can check out, and saying so is the difference between „the
 * fix is deployed" and „something like the fix is deployed".
 */
export const buildId = (cwd = process.cwd()): string => {
  const git = (command: string): string =>
    execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return `${git('git rev-parse --short HEAD')}${git('git status --porcelain') ? '-dirty' : ''}`
  } catch {
    return 'unknown'
  }
}
