import type { SpecialtyPack } from './types.js'

/**
 * The menu a new school of this kind starts with.
 *
 * It used to list five entries — За училището, Документи, Екип, Прием — that
 * no pack creates a page for. Provisioning published the pack's pages and then
 * set the menu, two steps that never compared notes, so a school opened on its
 * first day with four items that 404 and a broken link on every page that
 * carries the menu. Measured on one deployment: two pages, five items, thirty
 * broken internal links.
 *
 * So a menu entry names a page some pack ships, or states why it points
 * somewhere no page is. A school adds the rest as it writes them, which is the
 * only moment at which the entry becomes true.
 */
const COMMON_NAV = [
  { label: 'Начало', provided: 'the site root, served by the host rather than by a pack page', url: '/' },
]

/**
 * Vocational school of tourism.
 *
 * What distinguishes it from a general gymnasium is where the learning happens:
 * kitchens, dining rooms and hotels, under a mentor, assessed by a state
 * practical examination. The vocabulary below follows that.
 */
export const vocationalTourism: SpecialtyPack = {
  code: 'vocational-tourism',
  departments: [
    { label: 'Български език и литература', value: 'bulgarian' },
    { label: 'Чужди езици', value: 'languages' },
    { label: 'Математика и информатика', value: 'math-it' },
    { label: 'Природни науки', value: 'sciences' },
    { label: 'Обществени науки', value: 'humanities' },
    { label: 'Физическо възпитание и спорт', value: 'pe' },
    { label: 'Професионална подготовка — туризъм', value: 'tourism' },
    { label: 'Професионална подготовка — кулинарство', value: 'culinary' },
    { label: 'Професионална подготовка — хотелиерство', value: 'hospitality' },
    { label: 'Непедагогически персонал', value: 'support' },
  ],
  name: 'Професионална гимназия по туризъм',
  navigation: [...COMMON_NAV, { label: 'Практика', url: '/praktika' }],
  pages: [
    {
      markdown: `## Професионално обучение

Училището подготвя специалисти по туризъм, кулинарство и хотелиерство.
Обучението съчетава теория в училище с практика в базови обекти.

## Учебна практика

Практиката се провежда в действащи хотели и ресторанти под ръководството на
наставник. Всеки период завършва с оценка, която влиза в професионалната
квалификация на ученика.

## Здраве и безопасност

Работата с храни и настаняване изисква спазване на правилата за здравословни и
безопасни условия. Контролните точки се водят за всяка кухня и всеки обект.`,
      slug: 'praktika',
      title: 'Практика и професионална подготовка',
    },
  ],
  typology: [
    { title: 'Институционални актове · чл. 263' },
    { title: 'Етичен кодекс · чл. 175' },
    { title: 'Организация на учебната година' },
    { note: 'Договори с базови обекти, графици и протоколи', title: 'Практическо обучение' },
    { title: 'Квалификация, възпитание и безопасност' },
    { title: 'Прозрачност и администрация' },
  ],
}

/** General secondary school — the comparison case, with no practice placements. */
export const generalSecondary: SpecialtyPack = {
  code: 'general-secondary',
  departments: [
    { label: 'Български език и литература', value: 'bulgarian' },
    { label: 'Чужди езици', value: 'languages' },
    { label: 'Математика и информатика', value: 'math-it' },
    { label: 'Природни науки', value: 'sciences' },
    { label: 'Обществени науки', value: 'humanities' },
    { label: 'Изкуства', value: 'arts' },
    { label: 'Физическо възпитание и спорт', value: 'pe' },
    { label: 'Непедагогически персонал', value: 'support' },
  ],
  name: 'Средно общообразователно училище',
  navigation: [...COMMON_NAV, { label: 'Профили и прием', url: '/profili' }],
  pages: [
    {
      markdown: `## Профили

Училището предлага общообразователна подготовка с профилирани паралелки в
горния курс.

## Прием

Приемът след седми клас се провежда по график на Министерството на образованието
и науката. Заповедите и графиците се публикуват в раздел „Документи“.`,
      slug: 'profili',
      title: 'Профили и прием',
    },
  ],
  typology: [
    { title: 'Институционални актове · чл. 263' },
    { title: 'Етичен кодекс · чл. 175' },
    { title: 'Организация на учебната година' },
    { title: 'Квалификация, възпитание и безопасност' },
    { title: 'Прозрачност и администрация' },
  ],
}

export const SPECIALTIES: Record<string, SpecialtyPack> = {
  'general-secondary': generalSecondary,
  'vocational-tourism': vocationalTourism,
}
