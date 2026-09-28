import type { LocaleCode } from '../i18n/index.js'

import { DEFAULT_LOCALE } from '../i18n/index.js'
import { STYLES } from './styles.js'
import { VERIFIER_SOURCE } from './verifier.js'

/**
 * The page a parent opens.
 *
 * Every other surface in this package answers a machine. This one answers the
 * audience the fairness work was for and who cannot reach any of it: a parent
 * with a link, on a phone, who wants to know whether their class's draw was
 * honest.
 *
 * It is one document with no build step, no framework and no network
 * dependency, because it has to be served from a Worker and because a
 * verification page that cannot load without a CDN is a verification page that
 * stops working on the day it matters.
 *
 * The arithmetic runs in the reader's browser. Nothing on this page asks the
 * server for a verdict — the server hands over the receipt, the revealed seed
 * and a path of sibling hashes, and the page does the rest. That is the
 * difference between checking and being told.
 */

export type VerifyPageOptions = {
  /** Where the page fetches its draws from. */
  dataUrl?: string
  /** Shown in the header. The school's own name, not this package's. */
  schoolName?: string
  /** Page language; the copy below is provided in these. */
  locale?: LocaleCode
}

type Copy = Record<string, string>

const COPY: Record<LocaleCode, Copy> = {
  bg: {
    checkedHere: 'Проверено във вашия браузър',
    checking: 'Проверка…',
    insecure:
      'Тази страница се нуждае от защитена връзка (https), за да извърши изчисленията. Отворете я през https и проверките ще се изпълнят във вашия браузър.',
    stepFailed: 'Това теглене не можа да бъде проверено: ',
    className: 'Клас',
    drawn: 'Изтеглен',
    empty: 'За този клас още няма записани тегления.',
    failed: 'Тази проверка не премина',
    heading: 'Проверка на теглене',
    intro:
      'Изчисленията се извършват във вашия браузър. Тази страница не пита сървъра дали тегленето е честно — тя го пресмята.',
    notPublished:
      'Училището не е публикувало кой е избран. Това е лично данни на ученик и е отделно решение от това дали тегленето е било честно.',
    passed: 'Тази проверка премина',
    pending: 'Още не може да бъде проверено',
    problem: 'Данните не можаха да бъдат заредени.',
    retry: 'Опитай отново',
    selected: 'Избран',
    sequence: 'Теглене',
    title: 'Проверка на теглене',
    undecided: 'Не може да се реши тук',
    verdictFalse: 'Тази проверка НЕ премина',
    verdictNull: 'Все още не може да бъде проверено',
    verdictTrue: 'Всички проверки преминаха',
  },
  de: {
    checkedHere: 'In Ihrem Browser geprüft',
    checking: 'Wird geprüft…',
    className: 'Klasse',
    drawn: 'Gezogen',
    empty: 'Für diese Klasse sind noch keine Ziehungen erfasst.',
    failed: 'Diese Prüfung ist nicht bestanden',
    heading: 'Eine Ziehung prüfen',
    insecure:
      'Diese Seite braucht eine sichere Verbindung (https), um zu rechnen. Öffnen Sie sie über https, dann laufen die Prüfungen hier in Ihrem Browser.',
    intro:
      'Die Rechnung läuft in Ihrem Browser. Diese Seite fragt den Server nicht, ob die Ziehung fair war — sie rechnet es nach.',
    notPublished:
      'Die Schule hat nicht veröffentlicht, wer ausgewählt wurde. Das sind personenbezogene Daten eines Kindes und eine andere Entscheidung als die, ob die Ziehung fair war.',
    passed: 'Diese Prüfung ist bestanden',
    pending: 'Noch nicht prüfbar',
    problem: 'Die Ziehungen konnten nicht geladen werden.',
    retry: 'Erneut versuchen',
    selected: 'Ausgewählt',
    sequence: 'Ziehung',
    stepFailed: 'Diese Ziehung konnte nicht geprüft werden: ',
    title: 'Eine Ziehung prüfen',
    undecided: 'Hier nicht entscheidbar',
    verdictFalse: 'Diese Ziehung wurde NICHT bestätigt',
    verdictNull: 'Diese Ziehung ist noch nicht prüfbar',
    verdictTrue: 'Alle Prüfungen bestanden',
  },
  fr: {
    checkedHere: 'Vérifié dans votre navigateur',
    checking: 'Vérification…',
    className: 'Classe',
    drawn: 'Tiré',
    empty: 'Aucun tirage n’est encore enregistré pour cette classe.',
    failed: 'Cette vérification a échoué',
    heading: 'Vérifier un tirage',
    insecure:
      'Cette page a besoin d’une connexion sécurisée (https) pour faire le calcul. Ouvrez-la en https et les vérifications se feront ici, dans votre navigateur.',
    intro:
      'Le calcul se fait dans votre navigateur. Cette page ne demande pas au serveur si le tirage était équitable — elle le recalcule.',
    notPublished:
      'L’école n’a pas publié qui a été sélectionné. Ce sont les données personnelles d’un élève, et c’est une décision distincte de celle de savoir si le tirage était équitable.',
    passed: 'Cette vérification est passée',
    pending: 'Pas encore vérifiable',
    problem: 'Les tirages n’ont pas pu être chargés.',
    retry: 'Réessayer',
    selected: 'Sélectionné',
    sequence: 'Tirage',
    stepFailed: 'Ce tirage n’a pas pu être vérifié : ',
    title: 'Vérifier un tirage',
    undecided: 'Non décidable ici',
    verdictFalse: 'Ce tirage n’a PAS été vérifié',
    verdictNull: 'Ce tirage n’est pas encore vérifiable',
    verdictTrue: 'Toutes les vérifications sont passées',
  },
  es: {
    checkedHere: 'Comprobado en su navegador',
    checking: 'Comprobando…',
    className: 'Clase',
    drawn: 'Sorteado',
    empty: 'Todavía no hay sorteos registrados para esta clase.',
    failed: 'Esta comprobación no ha pasado',
    heading: 'Verificar un sorteo',
    insecure:
      'Esta página necesita una conexión segura (https) para hacer el cálculo. Ábrala por https y las comprobaciones se harán aquí, en su navegador.',
    intro:
      'El cálculo se hace en su navegador. Esta página no le pregunta al servidor si el sorteo fue justo — lo calcula.',
    notPublished:
      'El centro no ha publicado quién fue seleccionado. Son datos personales de un alumno, y es una decisión distinta de si el sorteo fue justo.',
    passed: 'Esta comprobación ha pasado',
    pending: 'Todavía no se puede comprobar',
    problem: 'No se han podido cargar los sorteos.',
    retry: 'Reintentar',
    selected: 'Seleccionado',
    sequence: 'Sorteo',
    stepFailed: 'Este sorteo no se ha podido comprobar: ',
    title: 'Verificar un sorteo',
    undecided: 'No decidible aquí',
    verdictFalse: 'Este sorteo NO se ha verificado',
    verdictNull: 'Este sorteo todavía no se puede comprobar',
    verdictTrue: 'Todas las comprobaciones han pasado',
  },
  ru: {
    checkedHere: 'Проверено в вашем браузере',
    checking: 'Проверка…',
    className: 'Класс',
    drawn: 'Проведён',
    empty: 'Для этого класса ещё нет записанных жеребьёвок.',
    failed: 'Эта проверка не пройдена',
    heading: 'Проверка жеребьёвки',
    insecure:
      'Этой странице нужно защищённое соединение (https), чтобы выполнить вычисления. Откройте её по https, и проверки пройдут здесь, в вашем браузере.',
    intro:
      'Вычисления выполняются в вашем браузере. Эта страница не спрашивает сервер, была ли жеребьёвка честной, — она сама это считает.',
    notPublished:
      'Школа не опубликовала, кто был выбран. Это персональные данные ученика и отдельное решение от того, была ли жеребьёвка честной.',
    passed: 'Эта проверка пройдена',
    pending: 'Пока проверить нельзя',
    problem: 'Не удалось загрузить жеребьёвки.',
    retry: 'Повторить',
    selected: 'Выбран',
    sequence: 'Жеребьёвка',
    stepFailed: 'Эту жеребьёвку не удалось проверить: ',
    title: 'Проверка жеребьёвки',
    undecided: 'Здесь не решается',
    verdictFalse: 'Эта жеребьёвка НЕ подтверждена',
    verdictNull: 'Эту жеребьёвку пока нельзя проверить',
    verdictTrue: 'Все проверки пройдены',
  },
  zh: {
    checkedHere: '已在您的浏览器中核验',
    checking: '正在核验…',
    className: '班级',
    drawn: '抽取',
    empty: '该班级尚无已记录的抽取。',
    failed: '此项核验未通过',
    heading: '核验一次抽取',
    insecure: '此页面需要安全连接（https）才能进行计算。请通过 https 打开，核验将在您的浏览器中进行。',
    intro: '计算在您的浏览器中进行。本页不会询问服务器抽取是否公正——它自己算出结果。',
    notPublished: '学校尚未公布被选中者。那是学生的个人资料，与抽取是否公正是两件事。',
    passed: '此项核验通过',
    pending: '尚无法核验',
    problem: '无法载入抽取记录。',
    retry: '重试',
    selected: '被选中',
    sequence: '抽取',
    stepFailed: '此次抽取无法核验：',
    title: '核验一次抽取',
    undecided: '此处无法判定',
    verdictFalse: '此次抽取未通过核验',
    verdictNull: '此次抽取尚无法核验',
    verdictTrue: '全部核验通过',
  },
  en: {
    checkedHere: 'Checked in your browser',
    checking: 'Checking…',
    insecure:
      'This page needs a secure connection (https) to do the arithmetic. Open it over https and the checks will run here in your browser.',
    stepFailed: 'This draw could not be checked: ',
    className: 'Class',
    drawn: 'Drawn',
    empty: 'No draws have been recorded for this class yet.',
    failed: 'This check did not pass',
    heading: 'Verify a draw',
    intro:
      'The arithmetic runs in your browser. This page does not ask the server whether the draw was fair — it works it out.',
    notPublished:
      'The school has not published who was selected. That is a pupil’s personal data, and a separate decision from whether the draw was fair.',
    passed: 'This check passed',
    pending: 'Cannot be checked yet',
    problem: 'The draws could not be loaded.',
    retry: 'Try again',
    selected: 'Selected',
    sequence: 'Draw',
    title: 'Verify a draw',
    undecided: 'Not decidable here',
    verdictFalse: 'This draw did NOT verify',
    verdictNull: 'This draw cannot be checked yet',
    verdictTrue: 'Every check passed',
  },
}

const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' })[char] ?? char,
  )


/** The whole page, as one document. */
export function verifyPageHtml(options: VerifyPageOptions = {}): string {
  const locale = options.locale ?? DEFAULT_LOCALE
  const copy = COPY[locale]
  const dataUrl = options.dataUrl ?? '/api/school/verify/data'
  const school = options.schoolName ?? ''

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(copy.title!)}${school ? ` — ${escape(school)}` : ''}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <h1>${escape(copy.heading!)}</h1>
  <p class="intro">${escape(copy.intro!)}</p>

  <dl class="scope" id="scope" hidden>
    <dt>${escape(copy.className!)}</dt><dd id="scope-class"></dd>
  </dl>

  <div id="status" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span> ${escape(copy.checking!)}
  </div>

  <div id="draws"></div>
</main>

<script type="module">
${VERIFIER_SOURCE}

const COPY = ${JSON.stringify(copy)}
const DATA_URL = ${JSON.stringify(dataUrl)}

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const MARK = { false: '\\u2717', null: '\\u2013', true: '\\u2713' }

function renderDraw(draw, checked) {
  const card = el('article', 'draw')

  const head = el('div', 'draw__head')
  head.append(el('h2', null, COPY.sequence + ' ' + (draw.seq ?? '?')))

  const verdict = el('span', 'verdict',
    checked.verdict === true ? COPY.verdictTrue
    : checked.verdict === false ? COPY.verdictFalse
    : COPY.verdictNull)
  // Bounded at the point CSS reads it: "true", "false" or "null".
  verdict.dataset.state = String(checked.verdict)
  head.append(verdict)
  card.append(head)

  const steps = el('ul', 'steps')
  for (const step of checked.steps) {
    const item = el('li', 'step')
    item.dataset.ok = String(step.ok)

    const mark = el('span', 'step__mark', MARK[String(step.ok)])
    mark.setAttribute('aria-hidden', 'true')
    item.append(mark)

    const name = el('span', 'step__name', step.name)
    // The mark is decorative; the outcome is stated for a screen reader.
    name.append(el('span', 'visually-hidden',
      ' \\u2014 ' + (step.ok === true ? COPY.passed : step.ok === false ? COPY.failed : COPY.pending)))
    item.append(name)

    if (step.detail) item.append(el('span', 'step__detail', step.detail))
    steps.append(item)
  }
  card.append(steps)

  if (draw.outcome && draw.outcome.published) {
    const out = el('p', 'note', COPY.selected + ': ' + draw.outcome.selected)
    card.append(out)
  } else {
    card.append(el('p', 'note', COPY.notPublished))
  }

  card.append(el('p', 'local', COPY.checkedHere))
  return card
}

async function main() {
  const status = document.getElementById('status')
  const list = document.getElementById('draws')

  // Web Crypto is only available in a secure context. Without it this page
  // cannot check anything — and saying so is the only honest option, because
  // the alternative is a spinner that never stops.
  if (!globalThis.crypto || !crypto.subtle) {
    status.textContent = COPY.insecure
    return
  }

  let payload
  try {
    const response = await fetch(DATA_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(String(response.status))
    payload = await response.json()
  } catch {
    status.textContent = COPY.problem
    const again = el('button', null, COPY.retry)
    again.addEventListener('click', () => location.reload())
    status.append(document.createElement('br'), again)
    return
  }

  if (payload.class) {
    document.getElementById('scope-class').textContent = payload.class
    document.getElementById('scope').hidden = false
  }

  const draws = payload.draws ?? []
  if (draws.length === 0) {
    status.textContent = ''
    list.append(el('p', 'empty', COPY.empty))
    return
  }

  // Rendered as each one finishes: a parent with a slow phone sees the first
  // answer rather than a spinner until the last.
  for (const draw of draws) {
    let checked
    try {
      checked = await checkDraw(draw)
    } catch (error) {
      // One malformed receipt must not take the other draws down with it, and
      // must not leave the reader looking at a spinner.
      checked = {
        steps: [{ detail: String(error && error.message ? error.message : error), name: COPY.stepFailed, ok: false }],
        verdict: false,
      }
    }
    list.append(renderDraw(draw, checked))
  }
  status.textContent = ''
}

main()
</script>
</body>
</html>`
}
