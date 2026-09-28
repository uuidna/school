import type { LocaleCode } from '../i18n/index.js'

import { DEFAULT_LOCALE } from '../i18n/index.js'
import { STYLES } from './styles.js'

/**
 * The page a pupil opens.
 *
 * `school_researcher_financing` was built because uuidna is for researchers
 * whatever their age — a sixteen-year-old applying alone is the case that has
 * to work. It was reachable only over MCP, which no sixteen-year-old uses, so
 * the tool written for the independent researcher was open only to the staff
 * who least needed it. This closes that.
 *
 * **Nothing the pupil types is stored.** What they state about themselves goes
 * into the request, is assessed, and comes back in the answer. No record of
 * them is read and none is written — which is the only way a minor can be
 * served on a surface that deliberately excludes pupils' records, and the page
 * says so where they can see it rather than in a policy nobody opens.
 *
 * The answer is a to-do list, not a verdict. `undecided` with its reasons named
 * is the useful state: it says what would settle the question, which is what a
 * young person actually needs in order to find out what they may try for.
 */

export type DiscoverPageOptions = {
  dataUrl?: string
  locale?: LocaleCode
  schoolName?: string
}

type Copy = Record<string, string>

const COPY: Record<LocaleCode, Copy> = {
  bg: {
    age: 'На колко години сте?',
    ageAdult: '18 или повече',
    ageMinor: 'под 18',
    ageUnstated: 'предпочитам да не казвам',
    checking: 'Търсене…',
    consent: 'Родител или настойник е дал съгласие',
    consentHelp: 'Ако още не е — просто оставете празно. Това не е отказ.',
    eligible: 'Можете да кандидатствате',
    empty: 'Все още няма записани програми.',
    guardian: 'Съгласие на родител',
    heading: 'Какво мога да кандидатствам',
    ineligible: 'Не отговаряте на условие',
    intro:
      'Кажете каквото пожелаете за себе си и вижте какви програми съществуват. Нищо от написаното тук не се запазва никъде.',
    needed: 'За да се разбере, трябва:',
    privacy: 'Нищо от това не се запазва. Отговорът се изчислява и толкова.',
    problem: 'Програмите не можаха да бъдат заредени.',
    region: 'Област или регион',
    retry: 'Опитай отново',
    search: 'Търси',
    subjects: 'Какво Ви интересува?',
    subjectsHelp: 'Например: биология, история, астрономия',
    title: 'Какво мога да кандидатствам',
    undecided: 'Още не е ясно',
  },
  de: {
    age: 'Wie alt sind Sie?',
    ageAdult: '18 oder älter',
    ageMinor: 'unter 18',
    ageUnstated: 'lieber nicht sagen',
    checking: 'Suche…',
    consent: 'Ein Elternteil oder Vormund hat zugestimmt',
    consentHelp: 'Noch nicht? Einfach leer lassen. Das ist kein Nein.',
    eligible: 'Sie können sich bewerben',
    empty: 'Es sind noch keine Programme erfasst.',
    guardian: 'Zustimmung der Eltern',
    heading: 'Wofür kann ich mich bewerben',
    ineligible: 'Eine Bedingung ist nicht erfüllt',
    intro:
      'Sagen Sie so viel über sich, wie Sie möchten, und sehen Sie, welche Programme es gibt. Nichts davon wird gespeichert.',
    needed: 'Um das zu klären, fehlt noch:',
    privacy: 'Nichts hiervon wird gespeichert. Die Antwort wird berechnet, mehr nicht.',
    problem: 'Die Programme konnten nicht geladen werden.',
    region: 'Region',
    retry: 'Erneut versuchen',
    search: 'Suchen',
    subjects: 'Was interessiert Sie?',
    subjectsHelp: 'Zum Beispiel: Biologie, Geschichte, Astronomie',
    title: 'Wofür kann ich mich bewerben',
    undecided: 'Noch offen',
  },
  en: {
    age: 'How old are you?',
    ageAdult: '18 or over',
    ageMinor: 'under 18',
    ageUnstated: 'rather not say',
    checking: 'Looking…',
    consent: 'A parent or guardian has agreed',
    consentHelp: 'Not yet? Leave it blank. That is not a no.',
    eligible: 'You can apply',
    empty: 'No programmes have been recorded yet.',
    guardian: 'Parent’s agreement',
    heading: 'What can I apply for',
    ineligible: 'A condition is not met',
    intro:
      'Say as much about yourself as you like, and see what exists. None of it is stored anywhere.',
    needed: 'To find out, this is still needed:',
    privacy: 'None of this is kept. The answer is worked out and that is all.',
    problem: 'The programmes could not be loaded.',
    region: 'Region',
    retry: 'Try again',
    search: 'Search',
    subjects: 'What are you interested in?',
    subjectsHelp: 'For example: biology, history, astronomy',
    title: 'What can I apply for',
    undecided: 'Not settled yet',
  },
  es: {
    age: '¿Qué edad tiene?',
    ageAdult: '18 o más',
    ageMinor: 'menos de 18',
    ageUnstated: 'prefiero no decirlo',
    checking: 'Buscando…',
    consent: 'Un padre, madre o tutor ha dado su acuerdo',
    consentHelp: '¿Todavía no? Déjelo en blanco. Eso no es un no.',
    eligible: 'Puede solicitarlo',
    empty: 'Todavía no hay programas registrados.',
    guardian: 'Acuerdo del tutor',
    heading: 'A qué puedo optar',
    ineligible: 'No se cumple una condición',
    intro:
      'Diga lo que quiera sobre usted y vea qué existe. Nada de esto se guarda en ningún sitio.',
    needed: 'Para saberlo, aún hace falta:',
    privacy: 'Nada de esto se conserva. La respuesta se calcula y ya está.',
    problem: 'No se han podido cargar los programas.',
    region: 'Región',
    retry: 'Reintentar',
    search: 'Buscar',
    subjects: '¿Qué le interesa?',
    subjectsHelp: 'Por ejemplo: biología, historia, astronomía',
    title: 'A qué puedo optar',
    undecided: 'Aún sin resolver',
  },
  fr: {
    age: 'Quel âge avez-vous ?',
    ageAdult: '18 ans ou plus',
    ageMinor: 'moins de 18 ans',
    ageUnstated: 'je préfère ne pas le dire',
    checking: 'Recherche…',
    consent: 'Un parent ou tuteur a donné son accord',
    consentHelp: 'Pas encore ? Laissez vide. Ce n’est pas un refus.',
    eligible: 'Vous pouvez candidater',
    empty: 'Aucun programme n’est encore enregistré.',
    guardian: 'Accord du responsable',
    heading: 'À quoi puis-je candidater',
    ineligible: 'Une condition n’est pas remplie',
    intro:
      'Dites ce que vous voulez de vous-même et voyez ce qui existe. Rien de tout cela n’est conservé.',
    needed: 'Pour le savoir, il manque encore :',
    privacy: 'Rien de ceci n’est conservé. La réponse est calculée, c’est tout.',
    problem: 'Les programmes n’ont pas pu être chargés.',
    region: 'Région',
    retry: 'Réessayer',
    search: 'Rechercher',
    subjects: 'Qu’est-ce qui vous intéresse ?',
    subjectsHelp: 'Par exemple : biologie, histoire, astronomie',
    title: 'À quoi puis-je candidater',
    undecided: 'Pas encore tranché',
  },
  ru: {
    age: 'Сколько вам лет?',
    ageAdult: '18 или больше',
    ageMinor: 'меньше 18',
    ageUnstated: 'предпочитаю не говорить',
    checking: 'Поиск…',
    consent: 'Родитель или опекун дал согласие',
    consentHelp: 'Ещё нет? Просто оставьте пустым. Это не отказ.',
    eligible: 'Вы можете подать заявку',
    empty: 'Программы пока не записаны.',
    guardian: 'Согласие родителя',
    heading: 'На что я могу подать заявку',
    ineligible: 'Одно из условий не выполнено',
    intro:
      'Расскажите о себе столько, сколько захотите, и посмотрите, что существует. Ничего из этого нигде не сохраняется.',
    needed: 'Чтобы выяснить, ещё нужно:',
    privacy: 'Ничего из этого не сохраняется. Ответ просто вычисляется.',
    problem: 'Не удалось загрузить программы.',
    region: 'Регион',
    retry: 'Повторить',
    search: 'Искать',
    subjects: 'Что вам интересно?',
    subjectsHelp: 'Например: биология, история, астрономия',
    title: 'На что я могу подать заявку',
    undecided: 'Пока не решено',
  },
  zh: {
    age: '您多大年纪？',
    ageAdult: '18 岁及以上',
    ageMinor: '未满 18 岁',
    ageUnstated: '不便告知',
    checking: '查找中…',
    consent: '家长或监护人已同意',
    consentHelp: '还没有？留空即可。这不算拒绝。',
    eligible: '您可以申请',
    empty: '尚未记录任何项目。',
    guardian: '监护人同意',
    heading: '我可以申请什么',
    ineligible: '有一项条件不符合',
    intro: '您愿意说多少就说多少，看看有哪些项目。这些内容不会被保存。',
    needed: '要弄清楚，还需要：',
    privacy: '这些都不会保存。答案只是算出来的，仅此而已。',
    problem: '无法载入项目。',
    region: '地区',
    retry: '重试',
    search: '搜索',
    subjects: '您对什么感兴趣？',
    subjectsHelp: '例如：生物、历史、天文',
    title: '我可以申请什么',
    undecided: '尚未确定',
  },
}

const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' })[char] ?? char,
  )

/** The whole page, as one document. */
export function discoverPageHtml(options: DiscoverPageOptions = {}): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const copy = COPY[locale]
  const dataUrl = options.dataUrl ?? '/api/school/discover/data'
  const school = options.schoolName ?? ''

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(copy.title!)}${school ? ` — ${escape(school)}` : ''}</title>
<style>${STYLES}
.ask { display: grid; gap: 1rem; margin-bottom: 1.75rem; }
.ask label { display: grid; gap: 0.3rem; }
.ask .what { font-weight: 550; }
.ask .hint { color: var(--muted); font-size: 0.85em; }
.ask input[type="text"], .ask select {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink);
  font: inherit;
  min-height: 2.75rem;
  padding: 0.5rem 0.7rem;
  width: 100%;
}
.ask .row { align-items: center; display: flex; gap: 0.5rem; }
.ask .row input { min-height: 1.15rem; min-width: 1.15rem; }
.programme { border-bottom: 1px solid var(--line); padding: 1rem 0; }
.programme:last-child { border-bottom: 0; }
.programme h2 { margin-bottom: 0.3rem; }
.programme .who { color: var(--muted); font-size: 0.85em; }
.needed { color: var(--muted); font-size: 0.88em; margin: 0.55rem 0 0; padding-left: 1.1rem; }
.needed li { margin-bottom: 0.2rem; }
</style>
</head>
<body>
<main>
  <h1>${escape(copy.heading!)}</h1>
  <p class="intro">${escape(copy.intro!)}</p>

  <form class="ask" id="ask">
    <label>
      <span class="what">${escape(copy.age!)}</span>
      <select id="age" name="age">
        <option value="unstated">${escape(copy.ageUnstated!)}</option>
        <option value="no">${escape(copy.ageAdult!)}</option>
        <option value="yes">${escape(copy.ageMinor!)}</option>
      </select>
    </label>

    <label id="consent-wrap" hidden>
      <span class="row">
        <input id="consent" name="consent" type="checkbox">
        <span class="what">${escape(copy.consent!)}</span>
      </span>
      <span class="hint">${escape(copy.consentHelp!)}</span>
    </label>

    <label>
      <span class="what">${escape(copy.region!)}</span>
      <input id="region" name="region" type="text" autocomplete="off">
    </label>

    <label>
      <span class="what">${escape(copy.subjects!)}</span>
      <input id="subjects" name="subjects" type="text" autocomplete="off">
      <span class="hint">${escape(copy.subjectsHelp!)}</span>
    </label>

    <button type="submit">${escape(copy.search!)}</button>
  </form>

  <p class="local">${escape(copy.privacy!)}</p>

  <div id="status" role="status" aria-live="polite"></div>
  <div id="results"></div>
</main>

<script type="module">
const COPY = ${JSON.stringify(copy)}
const DATA_URL = ${JSON.stringify(dataUrl)}

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const age = document.getElementById('age')
const consentWrap = document.getElementById('consent-wrap')

// Asked only where it bears on the answer. A pupil who has not said whether
// they are a minor is not asked about a guardian they may not need.
const syncConsent = () => { consentWrap.hidden = age.value !== 'yes' }
age.addEventListener('change', syncConsent)
syncConsent()

function render(entry) {
  const card = el('article', 'programme')
  card.append(el('h2', null, entry.programme.name))
  card.append(el('p', 'who', entry.programme.authority))

  const state = String(entry.eligible)
  const verdict = el('span', 'verdict',
    entry.eligible === true ? COPY.eligible
    : entry.eligible === false ? COPY.ineligible
    : COPY.undecided)
  // Bounded at the point CSS reads it: "true", "false" or "null".
  verdict.dataset.state = String(entry.eligible)
  card.append(verdict)

  // Undecided is the useful state: it says what would settle the question.
  const open = [...(entry.undecidable ?? []), ...(entry.unmet ?? [])]
  if (open.length) {
    card.append(el('p', 'who', COPY.needed))
    const list = el('ul', 'needed')
    for (const reason of open) list.append(el('li', null, reason))
    card.append(list)
  }
  return card
}

document.getElementById('ask').addEventListener('submit', async (event) => {
  event.preventDefault()

  const status = document.getElementById('status')
  const results = document.getElementById('results')
  results.replaceChildren()
  status.textContent = COPY.checking

  // Sent, assessed, returned. Nothing is stored, so nothing is sent that the
  // pupil did not just type.
  const asked = new URLSearchParams()
  asked.set('isMinor', age.value)
  if (age.value === 'yes' && document.getElementById('consent').checked) {
    asked.set('guardianConsentAt', new Date().toISOString().slice(0, 10))
    asked.set('guardianConsentBy', 'stated on this page')
  }
  const region = document.getElementById('region').value.trim()
  if (region) asked.set('region', region)
  const subjects = document.getElementById('subjects').value.trim()
  if (subjects) asked.set('subjects', subjects)

  let payload
  try {
    const response = await fetch(DATA_URL + '?' + asked.toString(), {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(String(response.status))
    payload = await response.json()
  } catch {
    status.textContent = COPY.problem
    const again = el('button', null, COPY.retry)
    again.addEventListener('click', () => location.reload())
    status.append(document.createElement('br'), again)
    return
  }

  const assessed = payload.assessed ?? []
  status.textContent = ''
  if (assessed.length === 0) { results.append(el('p', 'empty', COPY.empty)); return }

  for (const entry of assessed) results.append(render(entry))
})
</script>
</body>
</html>`
}
