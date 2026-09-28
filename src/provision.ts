#!/usr/bin/env node
/**
 * Stands up a school from its packs, over MCP.
 *
 *   npx school-provision --name "СУ „Христо Ботев“" --slug hristo-botev \
 *     --domain example.workers.dev --specialty general-secondary
 *
 * Everything it writes comes from the jurisdiction and specialty packs plus the
 * four arguments above. If a school needs anything this script cannot express,
 * the pack boundary is in the wrong place — which is the point of running it.
 *
 * Targets any deployment: `--endpoint` and `MCP_API_KEY` decide which.
 *
 * A command, not a module. It runs on import, so it is reachable through `bin`
 * and deliberately absent from `exports` — a subpath that executes a CLI when
 * somebody imports it is a trap, and it caught the verifier before it caught
 * anybody else.
 */
import { jurisdictionFor, specialtyFor } from './packs/index.js'

const arg = (name: string, fallback?: string): string => {
  const index = process.argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value && fallback === undefined) {
    console.error(`missing --${name}`)
    process.exit(1)
  }
  return value ?? fallback!
}

// No default: a provisioning run that silently targets somebody else's school
// is the one mistake this script must not make.
const endpoint = arg('endpoint', process.env.MCP_ENDPOINT)
const key = process.env.MCP_API_KEY

if (!key) {
  console.error('MCP_API_KEY is not set')
  process.exit(1)
}

const school = {
  domain: arg('domain'),
  jurisdiction: arg('jurisdiction', 'bg'),
  name: arg('name'),
  slug: arg('slug'),
  specialty: arg('specialty', 'vocational-tourism'),
}

const jurisdiction = jurisdictionFor(school.jurisdiction)
const specialty = specialtyFor(school.specialty)

let rpcId = 0

const call = async (name: string, args: Record<string, unknown>) => {
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      id: ++rpcId,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: args, name },
    }),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)

  const body = (await response.json()) as {
    error?: { message: string }
    result?: { content?: { text: string }[]; isError?: boolean }
  }

  if (body.error) throw new Error(`${name}: ${body.error.message}`)

  const payload = body.result?.content?.[0]?.text ?? ''
  if (body.result?.isError) throw new Error(`${name}: ${payload}`)

  try {
    return JSON.parse(payload)
  } catch {
    return payload
  }
}

console.log(`provisioning ${school.name}`)
console.log(`  jurisdiction: ${jurisdiction.name}`)
console.log(`  specialty:    ${specialty.name}`)
console.log(`  endpoint:     ${endpoint}\n`)

/**
 * The words this script writes into a school it is standing up.
 *
 * They were Bulgarian literals, so provisioning a school anywhere produced a
 * document tree labelled in a language its staff might not read — the school
 * it was extracted from showing through. An international school has
 * international staff, and the first thing it sees should not be somebody
 * else's.
 *
 * Taken from the jurisdiction's own `defaultLocale`, falling back to English
 * rather than to whichever language happened to be written down first.
 */
const WORDS: Record<string, Record<string, string>> = {
  bg: {
    duties: 'Задължителни актове',
    home: 'Документите по закон са в раздел „Документи“.',
    official: 'официален сайт',
    pending: 'Очаква публикуване — заменете със самия документ',
    section: 'Раздел',
    sectionNote: 'Раздел от типологията на училищните документи',
    typology: 'типология',
  },
  de: {
    duties: 'Gesetzlich vorgeschriebene Akte',
    home: 'Die gesetzlich vorgeschriebenen Dokumente stehen unter „Dokumente“.',
    official: 'offizielle Website',
    pending: 'Noch nicht veröffentlicht — durch das Dokument selbst ersetzen',
    section: 'Abschnitt',
    sectionNote: 'Abschnitt der schulischen Dokumententypologie',
    typology: 'Typologie',
  },
  en: {
    duties: 'Statutory acts',
    home: 'The documents the law requires are under “Documents”.',
    official: 'official site',
    pending: 'Not yet published — replace with the document itself',
    section: 'Section',
    sectionNote: 'Section of the school document typology',
    typology: 'typology',
  },
  es: {
    duties: 'Actos obligatorios',
    home: 'Los documentos que exige la ley están en «Documentos».',
    official: 'sitio oficial',
    pending: 'Pendiente de publicación — sustituya por el documento',
    section: 'Sección',
    sectionNote: 'Sección de la tipología de documentos del centro',
    typology: 'tipología',
  },
  fr: {
    duties: 'Actes obligatoires',
    home: 'Les documents exigés par la loi se trouvent sous « Documents ».',
    official: 'site officiel',
    pending: 'En attente de publication — remplacer par le document lui-même',
    section: 'Section',
    sectionNote: 'Section de la typologie documentaire de l’école',
    typology: 'typologie',
  },
  ru: {
    duties: 'Обязательные акты',
    home: 'Документы, требуемые законом, находятся в разделе «Документы».',
    official: 'официальный сайт',
    pending: 'Ожидает публикации — замените самим документом',
    section: 'Раздел',
    sectionNote: 'Раздел типологии школьных документов',
    typology: 'типология',
  },
  zh: {
    duties: '法定文件',
    home: '法律要求的文件位于「文件」栏目。',
    official: '官方网站',
    pending: '尚未发布 — 请替换为文件本身',
    section: '栏目',
    sectionNote: '学校文件类型体系的栏目',
    typology: '类型体系',
  },
}

const words = WORDS[jurisdiction.defaultLocale] ?? WORDS.en!

// 1 · The typology sections this kind of school keeps.
for (const section of specialty.typology) {
  await call('school_record_required_document', {
    category: words.section,
    legalBasis: words.typology,
    note: section.note ?? words.sectionNote,
    title: section.title,
  })
  console.log(`  section   ${section.title}`)
}

// 2 · Placeholders for every statutory duty, so the compliance report names
//     what is outstanding instead of silently reporting nothing at all.
for (const duty of jurisdiction.publications) {
  await call('school_record_required_document', {
    category: words.duties,
    legalBasis: duty.basis,
    note: words.pending,
    title: duty.name,
  })
  console.log(`  duty      ${duty.basis.padEnd(28)} ${duty.name}`)
}

// 3 · Starter pages from the specialty pack.
for (const page of specialty.pages) {
  const result = await call('school_publish_page', {
    markdown: page.markdown,
    slug: page.slug,
    title: page.title,
  })
  console.log(`  page      ${result.action ?? 'ok'} /${page.slug}`)
}

// 4 · A home page naming the school.
await call('school_publish_page', {
  markdown: `## ${specialty.name}\n\n${school.name} — ${words.official}.\n\n${words.home}`,
  slug: 'home',
  title: school.name,
})
console.log('  page      home')

// 5 · Navigation.
await call('school_set_navigation', { items: specialty.navigation })
console.log(`  nav       ${specialty.navigation.length} items`)

// 6 · The audit the school will be judged by, run immediately.
const status = await call('school_legal_publication_status', {})
console.log(
  `\ncompliance: ${status.published}/${status.total} statutory publications recorded` +
    `${status.missing?.length ? `, missing ${status.missing.length}` : ''}`,
)

console.log(`\n${school.name} is provisioned. Create the first user at the /admin URL of ${school.domain}.`)
process.exit(0)
