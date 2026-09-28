import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildProcesses } from './builds.js'

const NEXT = '/repo/node_modules/.bin/next build'
const OPENNEXT = '/usr/local/bin/node /repo/node_modules/.bin/opennextjs-cloudflare deploy'

test('counts a build', () => {
  assert.deepEqual(buildProcesses(`4001 ${NEXT}`, 1).map((p) => p.pid), [4001])
  assert.deepEqual(buildProcesses(`4002 ${OPENNEXT}`, 1).map((p) => p.pid), [4002])
})

// THIS COST A REFUSED DEPLOY. The watcher's own command line says „next build",
// so a shell in another checkout waiting for a build that had already finished
// looked exactly like a build in progress.
test('does not count a shell waiting for one to finish', () => {
  const watcher = '4003 /bin/zsh -c until ! pgrep -f "next build"; do sleep 45; done'
  assert.deepEqual(buildProcesses(watcher, 1), [])
})

test('does not count the question being asked', () => {
  assert.deepEqual(buildProcesses('4004 pgrep -fl opennextjs-cloudflare|next build', 1), [])
})

test('does not count itself', () => {
  assert.deepEqual(buildProcesses(`4005 ${NEXT}`, 4005), [])
})

// AND THE NARROWING WENT TOO FAR THE OTHER WAY, which only writing this found:
// `node_modules/.bin/next build` puts the program in argv0 and only the verb in
// the arguments, so reading the verb out of the arguments alone missed the one
// leftover process the guard exists to catch.
test('still finds the build among its watchers', () => {
  const table = [
    '4006 /bin/zsh -c until ! pgrep -f "next build"; do sleep 45; done',
    `4007 ${NEXT}`,
    '4008 grep -E next build',
  ].join('\n')
  assert.deepEqual(buildProcesses(table, 1).map((p) => p.pid), [4007])
})
