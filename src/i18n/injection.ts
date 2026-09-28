import type { LocaleCode } from './index.js'

/**
 * The words an instruction addressed to a model is written with, per ray.
 *
 * A school's site is edited by its staff and read by agents — the MCP surface
 * serves them, and a page's text reaches a model that is summarising or
 * answering questions about it. Text that says „ignore your previous
 * instructions" in a document is not content, and a scanner that looks for it
 * in one language finds it in one language.
 *
 * This list was nine English patterns and one Bulgarian, marked „in either
 * language" and therefore honest about covering two rays of seven. Poison is
 * written in whatever language the writer chose, and a German page saying
 * „Ignoriere alle vorherigen Anweisungen" walked past a scanner that reported
 * the site clean.
 *
 * VOCABULARY, NOT PATTERNS. The shapes — „<ignore> <all> <previous>
 * <instructions>" — are the same in every ray; only the words differ. So the
 * words are here and the patterns are built by crossing them, which means a
 * ray gains every shape at once and none can be forgotten for one of them.
 *
 * FALSE NEGATIVES ARE THE COST OF BEING WRONG HERE. A word missing from a ray
 * is poison reported as clean, so each list is deliberately a little wider than
 * the obvious translation.
 */
export type InjectionVocabulary = {
  /** „ignore", „disregard" — told to set something aside. */
  ignore: readonly string[]
  /** „instructions", „directions". */
  instructions: readonly string[]
  /** „assistant", „language model", „AI". */
  model: readonly string[]
  /** „previous", „prior", „above". */
  previous: readonly string[]
  /** „send", „reveal", „print" — told to emit something. */
  reveal: readonly string[]
  /** „secret", „token", „key", „password". */
  secret: readonly string[]
  /** „system prompt", as one phrase. */
  systemPrompt: readonly string[]
  /** „you are", „you are now a…". */
  youAre: readonly string[]
}

export const INJECTION_WORDS: Record<LocaleCode, InjectionVocabulary> = {
  bg: {
    ignore: ['игнорирай', 'игнорирайте', 'пренебрегни', 'пренебрегнете', 'забрави', 'забравете'],
    instructions: ['инструкции', 'указания', 'нареждания'],
    model: ['асистент', 'езиков модел', 'изкуствен интелект'],
    previous: ['предишни', 'предходни', 'горни', 'по-горе'],
    reveal: ['изпрати', 'изпратете', 'покажи', 'покажете', 'разкрий', 'разкрийте'],
    secret: ['тайна', 'токен', 'ключ', 'парола', 'идентификационни данни'],
    systemPrompt: ['системен промпт', 'системна инструкция', 'системно съобщение'],
    youAre: ['ти си', 'вие сте'],
  },
  de: {
    ignore: ['ignoriere', 'ignorieren', 'missachte', 'vergiss', 'vergessen'],
    instructions: ['anweisungen', 'anleitungen', 'vorgaben'],
    model: ['assistent', 'sprachmodell', 'künstliche intelligenz', 'ki-modell'],
    previous: ['vorherigen', 'vorigen', 'obigen', 'bisherigen'],
    reveal: ['sende', 'senden', 'zeige', 'zeigen', 'offenbare', 'gib aus'],
    secret: ['geheimnis', 'token', 'schlüssel', 'passwort', 'zugangsdaten'],
    systemPrompt: ['systemprompt', 'systemanweisung', 'systemnachricht'],
    youAre: ['du bist', 'sie sind'],
  },
  en: {
    ignore: ['ignore', 'disregard', 'forget'],
    instructions: ['instructions', 'directions', 'rules'],
    model: ['assistant', 'language model', 'ai'],
    previous: ['previous', 'prior', 'above', 'earlier'],
    reveal: ['send', 'reveal', 'print', 'show', 'output'],
    secret: ['secret', 'token', 'api key', 'credential', 'password'],
    systemPrompt: ['system prompt', 'system message'],
    youAre: ['you are'],
  },
  es: {
    ignore: ['ignora', 'ignore', 'olvida', 'descarta'],
    instructions: ['instrucciones', 'indicaciones', 'reglas'],
    model: ['asistente', 'modelo de lenguaje', 'inteligencia artificial'],
    previous: ['anteriores', 'previas', 'de arriba'],
    reveal: ['envía', 'envia', 'muestra', 'revela', 'imprime'],
    secret: ['secreto', 'token', 'clave', 'contraseña', 'credencial'],
    systemPrompt: ['prompt del sistema', 'mensaje del sistema', 'indicación del sistema'],
    youAre: ['eres', 'usted es'],
  },
  fr: {
    ignore: ['ignore', 'ignorez', 'oublie', 'oubliez', 'fais abstraction'],
    instructions: ['instructions', 'consignes', 'directives'],
    model: ['assistant', 'modèle de langage', 'intelligence artificielle'],
    previous: ['précédentes', 'précédents', 'ci-dessus', 'antérieures'],
    reveal: ['envoie', 'envoyez', 'montre', 'révèle', 'affiche'],
    secret: ['secret', 'jeton', 'clé', 'mot de passe', 'identifiants'],
    systemPrompt: ['invite système', 'prompt système', 'message système'],
    youAre: ['tu es', 'vous êtes'],
  },
  ru: {
    ignore: ['игнорируй', 'игнорируйте', 'проигнорируй', 'забудь', 'забудьте'],
    instructions: ['инструкции', 'указания', 'правила'],
    model: ['ассистент', 'языковая модель', 'искусственный интеллект'],
    previous: ['предыдущие', 'прежние', 'выше', 'вышеуказанные'],
    reveal: ['отправь', 'отправьте', 'покажи', 'покажите', 'раскрой', 'выведи'],
    secret: ['секрет', 'токен', 'ключ', 'пароль', 'учётные данные'],
    systemPrompt: ['системный промпт', 'системная инструкция', 'системное сообщение'],
    youAre: ['ты', 'вы'],
  },
  zh: {
    ignore: ['忽略', '无视', '忘记'],
    instructions: ['指令', '指示', '规则'],
    model: ['助手', '语言模型', '人工智能'],
    previous: ['之前', '以上', '上述', '先前'],
    reveal: ['发送', '显示', '泄露', '输出'],
    secret: ['密钥', '令牌', '密码', '凭据'],
    /*
     * „系统提示词" only, not „系统提示".
     *
     * The shorter form is ordinary software language — „系统提示学生按时到校"
     * is a system notifying pupils to arrive on time, and flagging it would
     * teach whoever reads the report to stop reading it. 提示词 is the term
     * for a model's prompt specifically.
     */
    systemPrompt: ['系统提示词'],
    youAre: ['你是'],
  },
}
