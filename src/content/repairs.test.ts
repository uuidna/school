import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LexicalNode } from './lexical.js'

import { textOf } from './lexical.js'
import { demoteH1s, dropLeadingTitle, promoteYearLabels, stripMarkdownResidue, totalOf } from './repairs.js'

const text = (value: string): LexicalNode => ({ text: value, type: 'text' })
const para = (...children: LexicalNode[]): LexicalNode => ({ children, type: 'paragraph' })
const heading = (tag: string, ...children: LexicalNode[]): LexicalNode => ({ children, tag, type: 'heading' })
const root = (...children: LexicalNode[]): LexicalNode => ({ children, type: 'root' })

test('stripMarkdownResidue: removes the heading marker a half-converted line left in a list item', () => {
  // /dostap-do-obshtestvena-informatsiya, where four of these were visible on
  // the page the Access to Public Information Act obliges the school to
  // publish.
  const state = root({
    children: [
      { children: [text('## '), { children: [text('ОТЧЕТ ЗА 2023')], type: 'link' }], type: 'listitem' },
    ],
    type: 'list',
  })
  const tally = stripMarkdownResidue(state)
  assert.equal(tally.stripped, 1)
  assert.equal(textOf(state), 'ОТЧЕТ ЗА 2023')
})

test('stripMarkdownResidue: removes a heading left with nothing in it', () => {
  const state = root(heading('h3'), para(text('после')))
  assert.equal(stripMarkdownResidue(state).emptied, 1)
  assert.equal((state.children!).length, 1)
})

test('stripMarkdownResidue: removes a heading whose only content is blank text', () => {
  // The shape on two posts: <h2>  </h2> renders as an empty heading above
  // the real one, and the children array is not empty, so a naive check for
  // `children.length === 0` misses it.
  const state = root(heading('h2', text('  ')), heading('h2', text('Истински')))
  stripMarkdownResidue(state)
  assert.equal((state.children!).length, 1)
  assert.equal(textOf(state), 'Истински')
})

test('stripMarkdownResidue: keeps an empty paragraph, which is how Lexical spaces a document', () => {
  const state = root(para(), para(text('а')))
  assert.equal(stripMarkdownResidue(state).emptied, undefined)
  assert.equal((state.children!).length, 2)
})

test('stripMarkdownResidue: resolves a backslash escape the converter should have consumed', () => {
  const state = root(para(text('\\- ученици – 101')))
  assert.equal(stripMarkdownResidue(state).unescaped, 1)
  assert.equal(textOf(state), '- ученици – 101')
})

test('stripMarkdownResidue: leaves a doubled backslash alone, because it escapes a real one', () => {
  const state = root(para(text('C:\\\\path')))
  stripMarkdownResidue(state)
  assert.equal(textOf(state), 'C:\\\\path')
})

test('stripMarkdownResidue: leaves a hash inside a sentence alone', () => {
  const state = root(para(text('кабинет #3 е на втория етаж')))
  assert.equal(totalOf(stripMarkdownResidue(state)), 0)
  assert.equal(textOf(state), 'кабинет #3 е на втория етаж')
})

test('stripMarkdownResidue: turns an autolink into a link a reader can click', () => {
  // /about-5-1: the school's prospectus, Bulgarian and English, was two
  // angle-bracketed addresses rendered as text.
  const state = root(para(text('<https://heyzine.com/flip-book/66e450cd28.html> - българска версия')))
  assert.equal(stripMarkdownResidue(state).linked, 1)

  const paragraph = state.children![0]!
  assert.equal(paragraph.children![0]!.type, 'link')
  assert.equal(paragraph.children![0]!.fields?.url, 'https://heyzine.com/flip-book/66e450cd28.html')
  assert.ok((textOf(state)).includes('- българска версия'))
})

test('stripMarkdownResidue: gives the same link the same id every run, so a rerun agrees with itself', () => {
  const idOf = () => {
    const state = root(para(text('<https://example.org/a.pdf>')))
    stripMarkdownResidue(state)
    return state.children![0]!.children![0]!.id as string
  }
  assert.equal(idOf(), idOf())
  assert.match(idOf(), /^[0-9a-f]{24}$/)
})

test('stripMarkdownResidue: changes nothing it has already changed', () => {
  const state = root(para(text('## '), text('\\- а')), heading('h3'))
  stripMarkdownResidue(state)
  assert.equal(totalOf(stripMarkdownResidue(state)), 0)
})

test('promoteYearLabels: promotes year paragraphs to the level the document already uses', () => {
  const state = root(
    heading('h3', text('2026 година')),
    para(text('2025 година')),
    para(text('2024 година')),
  )
  assert.equal(promoteYearLabels(state).promoted, 2)
  assert.deepEqual(state.children!.map((node) => node.tag), ['h3', 'h3', 'h3'])
})

test('promoteYearLabels: invents no structure in a document that never made a year a heading', () => {
  const state = root(para(text('2025 година')), para(text('2024 година')))
  assert.equal(totalOf(promoteYearLabels(state)), 0)
  assert.equal(state.children!.every((node) => node.type === 'paragraph'), true)
})

test('promoteYearLabels: removes a paragraph that repeats the heading above it', () => {
  const state = root(heading('h3', text('2025 година')), para(text('2025 година')))
  assert.equal(promoteYearLabels(state).removed, 1)
  assert.equal((state.children!).length, 1)
})

test('promoteYearLabels: does not promote a year that is part of a sentence', () => {
  const state = root(heading('h3', text('2026 година')), para(text('През 2024 година училището спечели проект')))
  assert.equal(promoteYearLabels(state).promoted, undefined)
})

test('promoteYearLabels: changes nothing it has already changed', () => {
  const state = root(heading('h3', text('2026 година')), para(text('2025 година')))
  promoteYearLabels(state)
  assert.equal(totalOf(promoteYearLabels(state)), 0)
})

const title = 'Галерия'

test('dropLeadingTitle: removes an opening heading that repeats the page title', () => {
  const state = root(heading('h2', text('Галерия')), para(text('снимки')))
  assert.equal(dropLeadingTitle(state, title).titleStripped, 1)
  assert.equal(textOf(state), 'снимки')
})

test('dropLeadingTitle: still finds it under the empty paragraph the converter leaves', () => {
  const state = root(para(), heading('h2', text('Галерия')), para(text('снимки')))
  assert.equal(dropLeadingTitle(state, title).titleStripped, 1)
})

test('dropLeadingTitle: leaves a matching heading further down alone', () => {
  // A section that legitimately repeats the title is not the opening one.
  const state = root(para(text('увод')), heading('h2', text('Галерия')))
  assert.equal(totalOf(dropLeadingTitle(state, title)), 0)
})

test('dropLeadingTitle: leaves a heading that says something else alone', () => {
  const state = root(heading('h2', text('Снимки от 2025')))
  assert.equal(totalOf(dropLeadingTitle(state, title)), 0)
})

test('dropLeadingTitle: changes nothing it has already changed', () => {
  const state = root(heading('h2', text('Галерия')), para(text('снимки')))
  dropLeadingTitle(state, title)
  assert.equal(totalOf(dropLeadingTitle(state, title)), 0)
})

test('demoteH1s: demotes an h1 in the body, wherever it is nested', () => {
  const state = root(heading('h1', text('а')), { children: [heading('h1', text('б'))], type: 'list' })
  assert.equal(demoteH1s(state).demoted, 2)
  assert.deepEqual(state.children!.map((node) => node.tag), ['h2', undefined])
})

test('demoteH1s: leaves other levels alone', () => {
  const state = root(heading('h2', text('а')), heading('h3', text('б')))
  assert.equal(totalOf(demoteH1s(state)), 0)
})

// THE RULE WAS ONE SCHOOL'S LANGUAGE. „2026 година" and „2026 г." were in the
// pattern; every other ray's year labels stayed body text, which shows up as a
// page that looks slightly wrong and reports nothing at all.
test('promoteYearLabels: a year label is recognised in every ray', () => {
  const labels: Record<string, string> = {
    bg: '2026 година',
    de: '2026 Jahr',
    en: '2026',
    es: '2026 año',
    fr: '2026 année',
    ru: '2026 год',
    zh: '2026年',
  }
  for (const [ray, label] of Object.entries(labels)) {
    const state = {
      children: [
        { children: [{ text: '2019 година', type: 'text' }], tag: 'h3', type: 'heading' },
        { children: [{ text: label, type: 'text' }], type: 'paragraph' },
      ],
      type: 'root',
    }
    const tally = promoteYearLabels(state)
    assert.equal(tally.promoted, 1, `${ray}: „${label}" was left as body text`)
  }
})

test('promoteYearLabels: a sentence that merely starts with a year is left alone', () => {
  const state = {
    children: [
      { children: [{ text: '2019 година', type: 'text' }], tag: 'h3', type: 'heading' },
      { children: [{ text: '2026 беше трудна година за всички', type: 'text' }], type: 'paragraph' },
    ],
    type: 'root',
  }
  assert.equal(promoteYearLabels(state).promoted, undefined)
})
