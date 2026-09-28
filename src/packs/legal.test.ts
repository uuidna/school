import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assessGuardianship } from '../financing/assess.js'
import { JURISDICTIONS, jurisdictionFor } from './index.js'
import { SPECIALTIES } from './specialties.js'

// A LEGAL FACT IN A PACK MUST SAY WHERE IT CAME FROM. The financing engine
// already refuses a programme with no provenance, on the grounds that a school
// acting on invented funding conditions loses the money and the work. A
// statutory age asserted with no citation is the same thing pointed at a child.

test('every stated age threshold carries a citation', () => {
  for (const [code, pack] of Object.entries(JURISDICTIONS)) {
    const ages = pack.ages
    if (!ages) continue

    const stated = ages.digitalConsent !== undefined || ages.majority !== undefined
    if (!stated) continue

    assert.ok(ages.source, `${code} states an age with no source`)
    assert.ok(ages.source!.cites, `${code} states an age with no provision cited`)
    assert.match(ages.source!.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${code}: no date checked`)
    assert.ok(
      ['primary', 'secondary'].includes(ages.source!.confidence),
      `${code}: confidence must say how firmly this is established`,
    )
  }
})

test('Bulgaria states both thresholds, and they are different questions', () => {
  const ages = jurisdictionFor('bg').ages!

  // Capacity to act in one's own name.
  assert.equal(ages.majority, 18)
  // Consent to processing, under GDPR art. 8 as transposed.
  assert.equal(ages.digitalConsent, 14)
  assert.match(ages.source!.cites, /25в/)
})

test('the lower threshold cannot weaken the guardianship guard', () => {
  // A child old enough to accept a privacy notice is not thereby old enough to
  // enter a funding commitment, and conflating them is how a 15-year-old is
  // signed up to something nobody is accountable for.
  const pack = jurisdictionFor('bg')
  const fifteen = assessGuardianship({ age: 15, kind: 'researcher' }, pack)

  assert.equal(fifteen!.required, true)
  assert.equal(fifteen!.satisfied, undefined, 'a 15-year-old was waved through')
})

test('an adult by the jurisdiction’s own measure needs no guardian', () => {
  const pack = jurisdictionFor('bg')
  assert.equal(assessGuardianship({ age: 18, kind: 'researcher' }, pack)!.required, false)
})

test('a pack that states no threshold still fails closed', () => {
  // The absence of a citation must never read as permission.
  const silent = { ...jurisdictionFor('bg'), ages: undefined }
  const seventeen = assessGuardianship({ age: 17, kind: 'researcher' }, silent)

  assert.equal(seventeen!.required, true)
})

test('secondary sourcing is declared rather than dressed up as the act', () => {
  // Read from regulator guidance and commentary quoting the statutory wording,
  // not from Държавен вестник. Saying so is the difference between a cited
  // figure and a verified one.
  assert.equal(jurisdictionFor('bg').ages!.source!.confidence, 'secondary')
})

// A MENU ENTRY IS A CLAIM THAT A PAGE EXISTS. Provisioning publishes a pack's
// pages and then sets its menu, and the two steps never compared notes: the
// common menu listed За училището, Документи, Екип and Прием, which no pack
// creates, so a school opened on its first day with four items that 404 on
// every page the menu appears on. Found by auditing a provisioned demo, not
// by reading the pack — which is why it is computed here now.

test('every navigation entry names a page the pack ships, or says why not', () => {
  for (const pack of Object.values(SPECIALTIES)) {
    const shipped = new Set(pack.pages.map((page) => `/${page.slug}`))

    const orphaned = pack.navigation
      .filter((entry) => !shipped.has(entry.url) && !entry.provided?.trim())
      .map((entry) => `${entry.label} → ${entry.url}`)

    assert.deepEqual(
      orphaned,
      [],
      `${pack.name}: these menu entries point at pages nothing creates — ship the page, or state why the address is served elsewhere`,
    )
  }
})

test('a page a pack ships is reachable from its menu', () => {
  // The other direction: a page published and never linked is a page nobody
  // opens, and provisioning has no other way to surface it.
  for (const pack of Object.values(SPECIALTIES)) {
    const linked = new Set(pack.navigation.map((entry) => entry.url))
    const unlinked = pack.pages.map((page) => page.slug).filter((slug) => !linked.has(`/${slug}`))

    assert.deepEqual(unlinked, [], `${pack.name}: these pages are published and linked from nowhere`)
  }
})
