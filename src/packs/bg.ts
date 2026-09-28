import type { JurisdictionPack } from './types.js'

/**
 * Bulgaria.
 *
 * The publication list is the operative part: `school_legal_publication_status`
 * reads it and reports what a school has not published. It is data so that a
 * change in the law is an edit here, not a change to the compliance engine —
 * and so that another jurisdiction is a new file rather than a fork.
 */
export const bulgaria: JurisdictionPack = {
  code: 'bg',
  ages: {
    // Пълнолетие at 18 (ЗЛС чл. 2): capacity to act in one's own name. Also
    // the strict default, so an error here cannot loosen anything — it can
    // only require a guardian where one was not needed.
    majority: 18,
    // GDPR art. 8, as Bulgaria transposed it: чл. 25в ЗЗЛД sets 14, and
    // processing a child's data on consent below that is lawful only where the
    // parent exercising parental rights, or the guardian, gave it.
    //
    // This threshold governs CONSENT TO PROCESSING, not capacity to apply for
    // anything — `majority` is what guards a funding application, and this
    // figure being lower cannot weaken that.
    digitalConsent: 14,
    source: {
      checkedAt: '2026-09-20',
      cites: 'ЗЗЛД чл. 25в (Регламент (ЕС) 2016/679, чл. 8)',
      // Regulator guidance (КЗЛД) and legal commentary quoting the statutory
      // wording, not the text as published in Държавен вестник. Marked so that
      // nobody mistakes the difference.
      confidence: 'secondary',
      url: 'https://cpdp.bg/',
    },
  },
  auditRetentionDays: 5 * 365,
  dataProtectionRegime: 'Регламент (ЕС) 2016/679 и Закон за защита на личните данни',
  defaultLocale: 'bg',
  name: 'България — ЗПУО',
  publications: [
    { basis: 'ЗПУО чл. 263, ал. 2, т. 1', match: 'стратегия за развитие', name: 'Стратегия за развитие' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 2', match: 'правилник за дейността', name: 'Правилник за дейността' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 3', match: 'учебен план', name: 'Училищен учебен план' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 4', match: 'форми на обучение', name: 'Форми на обучение' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 5', match: 'годишен план', name: 'Годишен план за дейността' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 7', match: 'мерки за повишаване', name: 'Мерки за повишаване на качеството' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 8', match: 'ранното напускане', name: 'Програма за превенция на ранното напускане' },
    { basis: 'ЗПУО чл. 263, ал. 2, т. 9', match: 'равни възможности', name: 'Програма за равни възможности и приобщаване' },
    { basis: 'ЗПУО чл. 175', match: 'етичен кодекс', name: 'Етичен кодекс на училищната общност' },
    { basis: 'Наредба за финансирането, чл. 9', match: 'бюджет', name: 'Бюджет и отчети за изпълнението' },
  ],
}

export const JURISDICTIONS: Record<string, JurisdictionPack> = { bg: bulgaria }
