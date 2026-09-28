import type { LocaleCode } from './index.js'

/**
 * The field help a school's staff read, in the seven rays.
 *
 * Payload takes `Record<string, string>` for `admin.description`, so these
 * reach the panel in the reader's own language rather than in mine. A
 * registrar in Hamburg filling in a statutory document had been reading
 * English hints about Bulgarian law.
 *
 * Kept in one table rather than inline, for the reason every locale table here
 * is: a phrase that exists in one ray and not another renders as nothing at
 * the moment somebody needs it, and only a table can be checked for holes.
 *
 * Shorter than the sentences they replace. Field help is read in passing, and
 * a paragraph in a sidebar is a paragraph nobody finishes.
 */

export type AdminKey =
  | 'actCitation'
  | 'actDate'
  | 'auditActor'
  | 'auditReason'
  | 'calendarAllDay'
  | 'calendarSource'
  | 'catalogueYear'
  | 'chainHash'
  | 'chainPrev'
  | 'chainSeq'
  | 'checkpointLength'
  | 'checkpointRoot'
  | 'classRosters'
  | 'contentHash'
  | 'criteriaData'
  | 'documentsFolder'
  | 'drawClass'
  | 'groupAdministration'
  | 'groupContent'
  | 'groupDraws'
  | 'groupSchool'
  | 'groupSystem'
  | 'jurisdictionCode'
  | 'legalBasis'
  | 'microsoftGroup'
  | 'programmeWindow'
  | 'provenance'
  | 'qpuMirror'
  | 'requiresFile'
  | 'roleGroups'
  | 'serverSeed'
  | 'slug'
  | 'sourceUrls'
  | 'workflowStages'
  | 'workspaceDomain'
  | 'workspaceGroup'
  | 'writableDirectory'

const TABLE: Record<AdminKey, Record<LocaleCode, string>> = {
  groupAdministration: {
    bg: 'Администрация',
    de: 'Verwaltung',
    en: 'Administration',
    es: 'Administración',
    fr: 'Gestion',
    ru: 'Администрация',
    zh: '管理',
  },
  groupContent: {
    bg: 'Съдържание',
    de: 'Inhalte',
    en: 'Content',
    es: 'Contenido',
    fr: 'Contenu',
    ru: 'Содержание',
    zh: '内容',
  },
  groupDraws: {
    bg: 'Жребий',
    de: 'Auslosung',
    en: 'Draws',
    es: 'Sorteos',
    fr: 'Tirages',
    ru: 'Жеребьёвка',
    zh: '抽签',
  },
  groupSchool: {
    bg: 'Училище',
    de: 'Schule',
    en: 'School',
    es: 'Escuela',
    fr: 'École',
    ru: 'Школа',
    zh: '学校',
  },
  groupSystem: {
    bg: 'Система',
    de: 'Systemdaten',
    en: 'System',
    es: 'Sistema',
    fr: 'Système',
    ru: 'Система',
    zh: '系统',
  },
  actCitation: {
    bg: 'Актът, както го цитира администрацията.',
    de: 'Der Rechtsakt, wie die Verwaltung ihn zitiert.',
    en: 'The act, cited as the administration cites it.',
    es: 'El acto, citado como lo cita la administración.',
    fr: 'L’acte, cité comme l’administration le cite.',
    ru: 'Акт в том виде, в каком его цитирует администрация.',
    zh: '该法令，按行政机关的引用格式。',
  },
  actDate: {
    bg: 'Дата на акта. Каталогът е толкова актуален, колкото одобрението му.',
    de: 'Datum des Rechtsakts. Der Katalog ist so aktuell wie seine Genehmigung.',
    en: 'Date of the act. A catalogue is as fresh as its approval.',
    es: 'Fecha del acto. Un catálogo es tan reciente como su aprobación.',
    fr: 'Date de l’acte. Un catalogue est aussi récent que son approbation.',
    ru: 'Дата акта. Каталог настолько свеж, насколько свежо его утверждение.',
    zh: '法令日期。目录的时效等同于其批准时间。',
  },
  auditActor: {
    bg: 'Кой е извършил промяната, както е бил удостоверен.',
    de: 'Wer die Änderung vorgenommen hat, wie authentifiziert.',
    en: 'Who made the change, as they were authenticated.',
    es: 'Quién hizo el cambio, tal como se autenticó.',
    fr: 'Qui a fait le changement, tel qu’authentifié.',
    ru: 'Кто внёс изменение — в том виде, как был аутентифицирован.',
    zh: '谁作出了变更，以其通过身份验证的形式。',
  },
  auditReason: {
    bg: 'Защо е дадено или отнето правото. Изисква се от чл. 5 §2 на Регламент (ЕС) 2016/679.',
    de: 'Warum das Recht erteilt oder entzogen wurde. Art. 5 Abs. 2 DSGVO verlangt es.',
    en: 'Why the right was given or removed. Required by art. 5(2) of Regulation (EU) 2016/679.',
    es: 'Por qué se concedió o retiró el derecho. Exigido por el art. 5(2) del Reglamento (UE) 2016/679.',
    fr: 'Pourquoi le droit a été accordé ou retiré. Exigé par l’art. 5(2) du règlement (UE) 2016/679.',
    ru: 'Почему право было предоставлено или отозвано. Требуется ст. 5(2) Регламента (ЕС) 2016/679.',
    zh: '该权限为何被授予或撤销。欧盟第2016/679号条例第5(2)条要求。',
  },
  calendarAllDay: {
    bg: 'Цял ден — например начало на срок.',
    de: 'Ganztägig — etwa ein Halbjahresbeginn.',
    en: 'All day — a term boundary, for instance.',
    es: 'Todo el día — por ejemplo, el inicio de un trimestre.',
    fr: 'Toute la journée — un début de trimestre, par exemple.',
    ru: 'Весь день — например, начало четверти.',
    zh: '全天——例如学期起始日。',
  },
  calendarSource: {
    bg: 'Календарът с учебните срокове и неучебните дни.',
    de: 'Der Kalender mit Schulzeiten und Schließtagen.',
    en: 'The calendar carrying term dates and closures.',
    es: 'El calendario con los periodos lectivos y los días no lectivos.',
    fr: 'Le calendrier des périodes scolaires et des fermetures.',
    ru: 'Календарь с учебными периодами и нерабочими днями.',
    zh: '存放学期与停课日期的日历。',
  },
  classRosters: {
    bg: 'Чете класовете и състава им оттук. Съставът се чете като идентификатори, не като имена.',
    de: 'Liest Klassen und ihre Zusammensetzung von hier. Die Mitgliedschaft wird als Kennungen gelesen, nie als Namen.',
    en: 'Read classes and who is in them from here. Membership is read as identifiers, never as names.',
    es: 'Lee las clases y su composición desde aquí. La pertenencia se lee como identificadores, nunca como nombres.',
    fr: 'Lit les classes et leur composition depuis ici. L’appartenance est lue comme des identifiants, jamais comme des noms.',
    ru: 'Читает классы и их состав отсюда. Состав читается как идентификаторы, а не как имена.',
    zh: '从这里读取班级及其成员。成员以标识符读取，绝不读取姓名。',
  },
  catalogueYear: {
    bg: 'Годината, за която са програмите. Обновяват се ежегодно.',
    de: 'Das Jahr, für das die Programme gelten. Jährlich neu gefasst.',
    en: 'The year these programmes are for. Revised annually.',
    es: 'El año al que corresponden estos programas. Se revisan cada año.',
    fr: 'L’année de ces programmes. Révisés chaque année.',
    ru: 'Год, к которому относятся программы. Пересматриваются ежегодно.',
    zh: '这些项目所属年度。每年修订。',
  },
  chainHash: {
    bg: 'H(seq ‖ предишен ‖ адрес). Уникален: две еднакви връзки не могат да съществуват.',
    de: 'H(seq ‖ vorheriger ‖ Adresse). Eindeutig: zwei gleiche Glieder kann es nicht geben.',
    en: 'H(seq ‖ prev ‖ address). Unique: two identical links cannot both exist.',
    es: 'H(seq ‖ anterior ‖ dirección). Único: no pueden existir dos enlaces iguales.',
    fr: 'H(seq ‖ précédent ‖ adresse). Unique : deux maillons identiques ne peuvent coexister.',
    ru: 'H(seq ‖ предыдущий ‖ адрес). Уникально: двух одинаковых звеньев быть не может.',
    zh: 'H(seq ‖ 前一个 ‖ 地址)。唯一：两个相同的链接不能并存。',
  },
  chainPrev: {
    bg: 'Връзката, към която е прикачена тази разписка.',
    de: 'Das Glied, an das diese Quittung angehängt wurde.',
    en: 'The link this receipt was attached to.',
    es: 'El enlace al que se adjuntó este recibo.',
    fr: 'Le maillon auquel ce reçu a été rattaché.',
    ru: 'Звено, к которому прикреплена эта квитанция.',
    zh: '本回执所挂接的链接。',
  },
  chainSeq: {
    bg: 'Позиция във веригата на това училище. Определя се автоматично.',
    de: 'Position in der Kette dieser Schule. Automatisch vergeben.',
    en: 'Position in this school’s chain. Assigned automatically.',
    es: 'Posición en la cadena de este centro. Se asigna automáticamente.',
    fr: 'Position dans la chaîne de cette école. Attribuée automatiquement.',
    ru: 'Позиция в цепочке этой школы. Назначается автоматически.',
    zh: '在本校链中的位置。自动分配。',
  },
  checkpointLength: {
    bg: 'Дължината на веригата при запечатването. Това улавя съкращаване.',
    de: 'Länge der Kette bei der Versiegelung. Das erkennt ein Abschneiden.',
    en: 'How long the chain was when sealed. This is what catches a truncation.',
    es: 'Longitud de la cadena al sellarla. Esto detecta un truncamiento.',
    fr: 'Longueur de la chaîne au moment du scellement. C’est ce qui détecte une troncature.',
    ru: 'Длина цепочки на момент опечатывания. Именно это выявляет усечение.',
    zh: '封存时链的长度。这是发现截断的依据。',
  },
  checkpointRoot: {
    bg: 'Merkle корен над запечатаните разписки.',
    de: 'Merkle-Wurzel über die versiegelten Quittungen.',
    en: 'Merkle root over the receipts sealed at this point.',
    es: 'Raíz de Merkle sobre los recibos sellados.',
    fr: 'Racine de Merkle sur les reçus scellés.',
    ru: 'Корень Меркла по опечатанным квитанциям.',
    zh: '已封存回执的 Merkle 根。',
  },
  contentHash: {
    bg: 'SHA-256 на файла. Уникален: едни и същи байтове се пазят веднъж.',
    de: 'SHA-256 der Datei. Eindeutig: gleiche Bytes werden einmal gespeichert.',
    en: 'SHA-256 of the file. Unique: the same bytes are stored once.',
    es: 'SHA-256 del archivo. Único: los mismos bytes se guardan una vez.',
    fr: 'SHA-256 du fichier. Unique : les mêmes octets sont stockés une fois.',
    ru: 'SHA-256 файла. Уникально: одни и те же байты хранятся один раз.',
    zh: '文件的 SHA-256。唯一：相同字节只存一次。',
  },
  criteriaData: {
    bg: 'Публикуваните условия, като данни. Текстът се пази дословно.',
    de: 'Die veröffentlichten Bedingungen als Daten. Der Wortlaut bleibt erhalten.',
    en: 'The published conditions, as data. The wording is kept verbatim.',
    es: 'Las condiciones publicadas, como datos. El texto se conserva literal.',
    fr: 'Les conditions publiées, sous forme de données. Le texte est conservé tel quel.',
    ru: 'Опубликованные условия в виде данных. Формулировка сохраняется дословно.',
    zh: '已公布的条件，以数据形式。措辞逐字保留。',
  },
  documentsFolder: {
    bg: 'Папката с документите, които законът изисква да бъдат публикувани.',
    de: 'Der Ordner mit den gesetzlich zu veröffentlichenden Dokumenten.',
    en: 'The folder holding the documents the law requires be published.',
    es: 'La carpeta con los documentos que la ley exige publicar.',
    fr: 'Le dossier contenant les documents que la loi impose de publier.',
    ru: 'Папка с документами, которые закон требует публиковать.',
    zh: '存放法律要求公布文件的文件夹。',
  },
  drawClass: {
    bg: 'Класът, в който е проведено тегленето. Само неговите ученици и родители могат да го четат.',
    de: 'Die Klasse, in der gezogen wurde. Nur deren Schüler und Eltern dürfen es lesen.',
    en: 'The class this draw ran within. Only its pupils and their parents may read it.',
    es: 'La clase en la que se hizo el sorteo. Solo su alumnado y sus familias pueden verlo.',
    fr: 'La classe où le tirage a eu lieu. Seuls ses élèves et leurs parents peuvent le lire.',
    ru: 'Класс, в котором проходила жеребьёвка. Читать могут только его ученики и их родители.',
    zh: '本次抽取所在的班级。仅该班学生及其家长可查看。',
  },
  jurisdictionCode: {
    bg: 'ISO 3166-1 alpha-2, с малки букви.',
    de: 'ISO 3166-1 alpha-2, Kleinbuchstaben.',
    en: 'ISO 3166-1 alpha-2, lower case.',
    es: 'ISO 3166-1 alfa-2, en minúsculas.',
    fr: 'ISO 3166-1 alpha-2, en minuscules.',
    ru: 'ISO 3166-1 alpha-2, строчными буквами.',
    zh: 'ISO 3166-1 alpha-2，小写。',
  },
  legalBasis: {
    bg: 'Разпоредбата, която го изисква, цитирана както я цитира тази юрисдикция.',
    de: 'Die Vorschrift, die es verlangt, zitiert wie in dieser Rechtsordnung üblich.',
    en: 'The provision requiring it, cited as this jurisdiction cites it.',
    es: 'La disposición que lo exige, citada como lo hace esta jurisdicción.',
    fr: 'La disposition qui l’exige, citée comme le fait cette juridiction.',
    ru: 'Норма, которая этого требует, в цитировании этой юрисдикции.',
    zh: '要求该项的法条，按本法域的引用格式。',
  },
  microsoftGroup: {
    bg: 'Microsoft 365 на училището. Хората остават в Entra ID, документите в SharePoint.',
    de: 'Das Microsoft 365 der Schule. Personen bleiben in Entra ID, Dokumente in SharePoint.',
    en: 'This school’s Microsoft 365. People stay in Entra ID, documents in SharePoint.',
    es: 'El Microsoft 365 del centro. Las personas siguen en Entra ID; los documentos, en SharePoint.',
    fr: 'Le Microsoft 365 de l’école. Les personnes restent dans Entra ID, les documents dans SharePoint.',
    ru: 'Microsoft 365 школы. Люди остаются в Entra ID, документы — в SharePoint.',
    zh: '本校的 Microsoft 365。人员留在 Entra ID，文档留在 SharePoint。',
  },
  programmeWindow: {
    bg: 'Оставете празно, ако няма публикуван срок. Празно не значи „отворено“.',
    de: 'Leer lassen, wenn keine Frist veröffentlicht wurde. Leer heißt nicht „offen“.',
    en: 'Leave empty if no window was published. Empty is not “open”.',
    es: 'Déjelo vacío si no se publicó un plazo. Vacío no significa «abierto».',
    fr: 'Laisser vide si aucun délai n’a été publié. Vide ne veut pas dire « ouvert ».',
    ru: 'Оставьте пустым, если срок не опубликован. Пусто — не значит «открыто».',
    zh: '若未公布申请期限，请留空。留空不等于「开放」。',
  },
  provenance: {
    bg: 'Откъде е прочетено и кога. Без това не се оценява.',
    de: 'Woher es gelesen wurde und wann. Ohne dies keine Bewertung.',
    en: 'Where this was read from, and when. Without it, it is not evaluated.',
    es: 'De dónde se leyó y cuándo. Sin ello, no se evalúa.',
    fr: 'D’où cela a été lu, et quand. Sans cela, ce n’est pas évalué.',
    ru: 'Откуда это прочитано и когда. Без этого не оценивается.',
    zh: '来源与读取时间。缺失则不予评估。',
  },
  qpuMirror: {
    bg: 'Състояние при външния свидетел, ако е настроен.',
    de: 'Status beim externen Zeugen, sofern konfiguriert.',
    en: 'Mirror status at the external witness, where one is configured.',
    es: 'Estado en el testigo externo, si está configurado.',
    fr: 'État chez le témoin externe, s’il est configuré.',
    ru: 'Состояние у внешнего свидетеля, если он настроен.',
    zh: '外部见证方的镜像状态（若已配置）。',
  },
  requiresFile: {
    bg: 'Изключете, ако органът приема декларация вместо файл.',
    de: 'Abwählen, wenn die Behörde eine Erklärung statt einer Datei akzeptiert.',
    en: 'Off where the authority accepts a declaration instead of a file.',
    es: 'Desactivado si la autoridad acepta una declaración en lugar de un archivo.',
    fr: 'Décoché si l’autorité accepte une déclaration au lieu d’un fichier.',
    ru: 'Снимите, если орган принимает декларацию вместо файла.',
    zh: '若主管机关接受声明而非文件，请取消勾选。',
  },
  roleGroups: {
    bg: 'Коя група дава коя роля. Адресът не различава завеждащ от учител.',
    de: 'Welche Gruppe welche Rolle verleiht. Die Adresse unterscheidet nicht Sekretariat von Lehrkraft.',
    en: 'Which group confers which role. An address cannot tell a registrar from a teacher.',
    es: 'Qué grupo otorga qué rol. Una dirección no distingue secretaría de profesorado.',
    fr: 'Quel groupe confère quel rôle. Une adresse ne distingue pas un secrétariat d’un enseignant.',
    ru: 'Какая группа даёт какую роль. Адрес не отличает секретаря от учителя.',
    zh: '哪个群组赋予哪个角色。地址无法区分教务与教师。',
  },
  serverSeed: {
    bg: 'Зърното, разкрито за проверка. Ново зърно за всяко теглене.',
    de: 'Der offengelegte Seed zur Nachprüfung. Pro Ziehung ein neuer.',
    en: 'The seed, revealed so the draw can be recomputed. A fresh one per draw.',
    es: 'La semilla, revelada para poder recalcular el sorteo. Una nueva por sorteo.',
    fr: 'La graine, révélée pour recalculer le tirage. Une nouvelle à chaque tirage.',
    ru: 'Зерно, раскрытое для пересчёта жеребьёвки. По одному на жеребьёвку.',
    zh: '已公开的种子，用于重算抽取。每次抽取使用新种子。',
  },
  slug: {
    bg: 'URL сегмент. Оставете празно, за да се образува от заглавието.',
    de: 'URL-Segment. Leer lassen, um es aus dem Titel zu bilden.',
    en: 'URL segment. Leave empty to derive it from the title.',
    es: 'Segmento de URL. Déjelo vacío para derivarlo del título.',
    fr: 'Segment d’URL. Laisser vide pour le dériver du titre.',
    ru: 'Сегмент URL. Оставьте пустым, чтобы получить его из заголовка.',
    zh: 'URL 片段。留空则由标题生成。',
  },
  sourceUrls: {
    bg: 'Къде е намерен файлът. Само се записва — не се отваря.',
    de: 'Wo die Datei gefunden wurde. Nur vermerkt — nie abgerufen.',
    en: 'Where the file was found. Recorded only — never retrieved.',
    es: 'Dónde se encontró el archivo. Solo se registra — nunca se descarga.',
    fr: 'Où le fichier a été trouvé. Uniquement consigné — jamais récupéré.',
    ru: 'Где найден файл. Только записывается — никогда не загружается.',
    zh: '文件的发现位置。仅记录，绝不抓取。',
  },
  workflowStages: {
    bg: 'Етапите, по реда, определен от органа.',
    de: 'Die Phasen, in der von der Behörde festgelegten Reihenfolge.',
    en: 'Stages, in the order the authority defines them.',
    es: 'Etapas, en el orden que define la autoridad.',
    fr: 'Étapes, dans l’ordre défini par l’autorité.',
    ru: 'Этапы в порядке, установленном органом.',
    zh: '阶段，按主管机关规定的顺序。',
  },
  workspaceDomain: {
    bg: 'Основният домейн. Учениците са <клас>@students.<домейн>.',
    de: 'Die Hauptdomäne. Schüler sind <klasse>@students.<domäne>.',
    en: 'The primary domain. Pupils are <class>@students.<domain>.',
    es: 'El dominio principal. El alumnado es <clase>@students.<dominio>.',
    fr: 'Le domaine principal. Les élèves sont <classe>@students.<domaine>.',
    ru: 'Основной домен. Ученики — <класс>@students.<домен>.',
    zh: '主域名。学生为 <班级>@students.<域名>。',
  },
  workspaceGroup: {
    bg: 'Google Workspace на училището. Хората остават в Directory, документите в Drive.',
    de: 'Das Google Workspace der Schule. Personen bleiben in Directory, Dokumente in Drive.',
    en: 'This school’s Google Workspace. People stay in Directory, documents in Drive.',
    es: 'El Google Workspace del centro. Las personas siguen en Directory; los documentos, en Drive.',
    fr: 'Le Google Workspace de l’école. Les personnes restent dans Directory, les documents dans Drive.',
    ru: 'Google Workspace школы. Люди остаются в Directory, документы — в Drive.',
    zh: '本校的 Google Workspace。人员留在 Directory，文档留在 Drive。',
  },
  writableDirectory: {
    bg: 'Разрешава промяна на роли. Изключено по подразбиране.',
    de: 'Erlaubt Rollenänderungen. Standardmäßig aus.',
    en: 'Allow role changes. Off by default.',
    es: 'Permite cambiar roles. Desactivado por defecto.',
    fr: 'Autorise les changements de rôle. Désactivé par défaut.',
    ru: 'Разрешает изменение ролей. По умолчанию выключено.',
    zh: '允许更改角色。默认关闭。',
  },
}

/**
 * Field help for the admin panel, in every ray.
 *
 * Payload renders the entry matching the reader's locale, so this is handed
 * over whole rather than resolved here.
 */
export const describe = (key: AdminKey): Record<string, string> => TABLE[key]

/** The keys this table carries, for a guard to walk. */
export const ADMIN_KEYS = Object.keys(TABLE) as AdminKey[]
