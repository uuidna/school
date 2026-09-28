import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { PayloadRequest } from 'payload'

import { jurisdictionFor } from '../packs/index.js'
import { complianceTools, LEGAL_PUBLICATIONS } from './compliance.js'

// A COMPLIANCE TOOL THAT ALWAYS ANSWERS "COMPLIANT" IS WORSE THAN NONE, because
// it produces a document an inspection is entitled to believe. So the suite
// asserts it notices a missing act, and asserts it can say no at all.

const tool = (name: string) => complianceTools.find((entry) => entry.name === name)!

const read = async (name: string, documents: Record<string, unknown>[]) => {
  const payload = {
    count: async () => ({ totalDocs: 1 }),
    find: async (args: { collection: string }) => {
      if (args.collection === 'tenants') {
        return { docs: [{ id: 1, domain: 'school.bg' }], hasNextPage: false, totalDocs: 1 }
      }
      const docs = args.collection === 'documents' ? documents : []
      return { docs, hasNextPage: false, totalDocs: docs.length }
    },
  }
  const req = { headers: new Headers({ host: 'school.bg' }), payload } as unknown as PayloadRequest
  const result = await tool(name).handler({}, req)
  return JSON.parse(result.content[0]!.text)
}

/** Every statutory duty, each answered by a document that can be obtained. */
const everything = () =>
  LEGAL_PUBLICATIONS.map((duty) => ({ filename: `${duty.match}.pdf`, title: duty.name }))

test('a school that has published everything is compliant', async () => {
  const report = await read('school_legal_publication_status', everything())

  assert.equal(report.compliant, true)
  assert.equal(report.missing.length, 0)
  assert.equal(report.total, LEGAL_PUBLICATIONS.length)
})

test('it notices a missing act and names the provision requiring it', async () => {
  const withoutRules = everything().filter((doc) => !doc.title.includes('Правилник'))
  const report = await read('school_legal_publication_status', withoutRules)

  assert.equal(report.compliant, false)
  assert.equal(report.missing.length, 1)
  assert.match(report.missing[0].basis, /чл\. 263/)
  assert.match(report.missing[0].requirement, /Правилник/)
})

test('a document recorded but not obtainable does not discharge the duty', async () => {
  // A row with a title and no file is an intention to publish. Reporting it as
  // compliant is how an inspection is failed on paper believed to be in order.
  const titleOnly = everything().map((doc) =>
    doc.title.includes('Правилник') ? { title: doc.title } : doc,
  )
  const report = await read('school_legal_publication_status', titleOnly)

  assert.equal(report.compliant, false)
  assert.match(report.missing[0].reason, /no file or link/)
})

test('a link, not only an uploaded file, discharges the duty', async () => {
  const linked = everything().map((doc) =>
    doc.title.includes('Правилник') ? { link: 'https://school.bg/rules', title: doc.title } : doc,
  )

  assert.equal((await read('school_legal_publication_status', linked)).compliant, true)
})

test('two documents answering one duty are both surfaced', async () => {
  // A current act beside a superseded one is the ordinary case; picking one
  // silently would hide the question an inspector actually asks.
  const doubled = [...everything(), { filename: 'old.pdf', title: 'Отменен правилник за дейността' }]
  const report = await read('school_legal_publication_status', doubled)

  const rules = report.requirements.find((r: { requirement: string }) => r.requirement.includes('Правилник'))
  assert.equal(rules.candidates.length, 2)
})

test('an empty school is not compliant — the check can say no', async () => {
  const report = await read('school_legal_publication_status', [])

  assert.equal(report.compliant, false)
  assert.equal(report.missing.length, LEGAL_PUBLICATIONS.length)
})

test('the audit names which legal system it used, and who chose it', async () => {
  const report = await read('school_legal_publication_status', everything())

  assert.equal(report.jurisdiction.code, 'bg')
  assert.ok(['default', 'environment', 'tenant'].includes(report.jurisdiction.source))
})

test('the checked list is the pack, not a second copy that can drift', async () => {
  assert.deepEqual(LEGAL_PUBLICATIONS, jurisdictionFor('bg').publications)
})
