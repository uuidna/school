import type { LocaleCode } from './index.js'

/**
 * Words a link uses instead of naming what it points at, per ray.
 *
 * A school's site links its statutory documents through whatever words the
 * person writing the page reached for, and those are very often not the
 * document's name: „Изтегли PDF", „Download", „hier klicken". Ingesting a file
 * under that label gives a register in which nine documents are called
 * „Download" and none can be found.
 *
 * NOT TRANSLATIONS OF EACH OTHER. Each ray lists what a page in that language
 * actually says, so overlap between rays is expected and harmless — „link" is
 * both English and German, and a Bulgarian page routinely carries an English
 * „Download" left in by a template.
 *
 * Here rather than beside the rule that uses it, because this is a locale
 * table and locale tables live in this folder — which is also what keeps the
 * guard against prose-in-one-language from having to grow an exemption.
 */
export const GENERIC_LABELS: Record<LocaleCode, readonly string[]> = {
  bg: ['изтегли', 'изтеглете', 'кликнете', 'натиснете', 'тук', 'линк', 'виж', 'отвори', 'документ', 'файл', 'повече'],
  de: ['herunterladen', 'download', 'hier', 'klicken', 'link', 'siehe', 'öffnen', 'dokument', 'datei', 'mehr'],
  en: ['download', 'click', 'here', 'link', 'see', 'open', 'document', 'file', 'more', 'read'],
  es: ['descargar', 'haga', 'clic', 'aquí', 'enlace', 'ver', 'abrir', 'documento', 'archivo', 'más'],
  fr: ['télécharger', 'cliquez', 'ici', 'lien', 'voir', 'ouvrir', 'document', 'fichier', 'plus'],
  ru: ['скачать', 'загрузить', 'нажмите', 'здесь', 'ссылка', 'смотреть', 'открыть', 'документ', 'файл', 'подробнее'],
  zh: ['下载', '点击', '这里', '链接', '查看', '打开', '文档', '文件', '更多'],
}

/** Format names, which are nobody's language and name no document either. */
export const FORMAT_LABELS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const
