import type {UserIntent, UserSentiment, UserIntentType, TopicThreadKey} from './types';

/**
 * Patterns indicating user is asking a question.
 */
const QUESTION_PATTERNS: RegExp[] = [
  /\?/,
  /\b(сколько|цена|стоимость|как|когда|где|что|почему|зачем|можно|нельзя)\b/i,
  /\b(how|what|when|where|why|how much|price|cost|can|could)\b/i,
  /\b(як|скільки|ціна|де|коли|чому|чи|можна)\b/i,
  /\b(kako|koliko|cena|gdje|kada|zašto|da li|može)\b/i
];

/**
 * Patterns indicating commitment/readiness to proceed.
 */
const COMMITMENT_PATTERNS: RegExp[] = [
  /\b(готов|готовы|начинаем|стартуем|поехали|давайте|давай|хочу|желаю)\b/i,
  /\b(ready|let'?s|start|begin|go|want|would like)\b/i,
  /\b(готовий|готові|починаємо|стартуємо|давайте|давай|хочу|бажаю)\b/i,
  /\b(spreman|gotov|počinjemo|krenimo|želim|hoću)\b/i,
  /\b(созвон|встреча|звонок|дзвінок|зустріч|call|meeting)\b/i,
  /\b(договор|кп|оценка|расчет|оцінка|розрахунок|proposal|estimate)\b/i
];

/**
 * Patterns indicating exploration mode (learning, not ready to commit).
 */
const EXPLORATION_PATTERNS: RegExp[] = [
  /\b(просто смотрю|просто гляджу|just looking|just browsing|разведка|дізнатися)\b/i,
  /\b(узнать|дізнатися|learn|explore|понять|зрозуміти|разобраться)\b/i,
  /\b(сколько примерно|приблизно|approximately|roughly|ориентировочно)\b/i,
  /\b(варианты|варіанти|options|possibilities|можливості)\b/i
];

/**
 * Patterns indicating objection or concern.
 */
const OBJECTION_PATTERNS: RegExp[] = [
  /\b(дорого|skupo|дорого|expensive|pricey|overpriced)\b/i,
  /\b(долго|довго|long|slow|delay|затянут|затягнут)\b/i,
  /\b(сомнение|сумнів|doubt|uncertain|не уверен|не впевнений)\b/i,
  /\b(риск|ризик|risk|проблема|проблема|problem|issue)\b/i
];

/**
 * Patterns indicating urgent sentiment.
 */
const URGENCY_PATTERNS: RegExp[] = [
  /\b(срочно|терміново|urgent|asap|быстро|швидко|fast|immediate)\b/i,
  /\b(сегодня|сьогодні|today|сейчас|зараз|now|immediately)\b/i,
  /\b(дедлайн|deadline|горит|горить|burning|critical)\b/i
];

/**
 * Patterns indicating positive sentiment.
 */
const POSITIVE_PATTERNS: RegExp[] = [
  /\b(отлично|чудово|great|excellent|super|класс|класно|odlično)\b/i,
  /\b(спасибо|дякую|thanks|thank you|благодарю|hvala)\b/i,
  /\b(понравилось|сподобалось|liked|love|нравиться|подобается)\b/i,
  /\b(хорошо|добре|good|fine|okay|ok|gаразд)\b/i
];

/**
 * Patterns indicating frustration or negative sentiment.
 */
const FRUSTRATION_PATTERNS: RegExp[] = [
  /\b(не понимаю|не розумію|don'?t understand|confused|неясно|незрозуміло)\b/i,
  /\b(сложно|складно|complicated|difficult|hard|запутанно|заплутано)\b/i,
  /\b(опять|знову|again|repeated|повторяете|повторюєте)\b/i,
  /\b(хватит|достаточно|довольно|enough|stop|прекратите|припиніть)\b/i
];

/**
 * Service-related keywords for topic classification.
 */
const SERVICE_KEYWORDS: Record<string, RegExp[]> = {
  website_app: [
    /\b(сайт|лендинг|веб|web|website|landing|page|интернет-магазин|магазин)\b/i,
    /\b(застосунок|додаток|app|application|mobile|мобильн|мобільн)\b/i
  ],
  automation: [
    /\b(автоматизац|automat|crm|amo|bitrix|notion|airtable)\b/i,
    /\b(интеграц|інтеграц|integrat|api|webhook|zapier|make)\b/i
  ],
  ai_assistant: [
    /\b(ai|ии|бот|chat|чат|assistant|асистент|помощник|помічник)\b/i,
    /\b(telegram|whatsapp|instagram|facebook|messenger)\b/i
  ],
  ui_ux: [
    /\b(ui|ux|дизайн|design|интерфейс|інтерфейс|interface)\b/i,
    /\b(прототип|prototype|wireframe|макет|mockup|figma)\b/i
  ],
  smm_growth: [
    /\b(smm|маркетинг|маркетинг|marketing|продвижен|просуван|promotion)\b/i,
    /\b(instagram|facebook|tiktok|youtube|telegram|ads|реклама|реклама)\b/i
  ],
  branding_logo: [
    /\b(бренд|brand|logo|логотип|айдентик|identity|фирменн|фірмов)\b/i,
    /\b(style|стиль|guideline|гайдлайн|brandbook|брендбук)\b/i
  ]
};

/**
 * Contact-related keywords.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /\b(email|почта|пошта|@|gmail|yahoo|outlook)\b/i,
  /\b(phone|телефон|номер|call me|позвон|зателефон)\b/i,
  /\b(telegram|телеграм|tg|@|handle|ник)\b/i,
  /\b(name|имя|ім'я|зовут|звати|call me)\b/i
];

/**
 * Logistics-related keywords (timeline, budget).
 */
const LOGISTICS_PATTERNS: RegExp[] = [
  /\b(бюджет|budget|стоимость|вартість|cost|price|цена|ціна)\b/i,
  /\b(срок|термін|timeline|deadline|дедлайн|когда|коли|when)\b/i,
  /\b(запуск|launch|старт|start|начало|початок)\b/i
];

/**
 * Detect user intent type from message.
 */
function detectIntentType(message: string, historyLength: number): UserIntentType {
  const hasQuestion = QUESTION_PATTERNS.some((pattern) => pattern.test(message));
  const hasCommitment = COMMITMENT_PATTERNS.some((pattern) => pattern.test(message));
  const hasExploration = EXPLORATION_PATTERNS.some((pattern) => pattern.test(message));
  const hasObjection = OBJECTION_PATTERNS.some((pattern) => pattern.test(message));
  const hasHandoffRequest = /\b(менеджер|менеджер|manager|human|person|живой|живий)\b/i.test(message);

  if (hasHandoffRequest) {
    return 'handoff_request';
  }

  if (hasObjection) {
    return 'objection';
  }

  if (hasCommitment && !hasExploration) {
    return 'commitment';
  }

  if (hasExploration || (hasQuestion && historyLength < 3)) {
    return 'exploration';
  }

  if (hasQuestion) {
    return 'question';
  }

  return 'statement';
}

/**
 * Detect user sentiment from message.
 */
function detectSentiment(message: string): UserSentiment {
  const hasUrgency = URGENCY_PATTERNS.some((pattern) => pattern.test(message));
  const hasFrustration = FRUSTRATION_PATTERNS.some((pattern) => pattern.test(message));
  const hasObjection = OBJECTION_PATTERNS.some((pattern) => pattern.test(message));
  const hasPositive = POSITIVE_PATTERNS.some((pattern) => pattern.test(message));

  if (hasFrustration) {
    return 'frustrated';
  }

  if (hasUrgency) {
    return 'urgent';
  }

  if (hasObjection) {
    return 'concerned';
  }

  if (hasPositive) {
    return 'positive';
  }

  return 'neutral';
}

/**
 * Classify which topics user is engaging with.
 */
function classifyTopics(message: string): TopicThreadKey[] {
  const topics: Set<TopicThreadKey> = new Set();
  const lowerMessage = message.toLowerCase();

  // Check for project scope topics
  for (const [serviceKey, patterns] of Object.entries(SERVICE_KEYWORDS)) {
    if (patterns.some((pattern) => pattern.test(message))) {
      topics.add('project_scope');
      break;
    }
  }

  // Check for logistics topics
  if (LOGISTICS_PATTERNS.some((pattern) => pattern.test(message))) {
    topics.add('logistics');
  }

  // Check for relationship topics
  if (CONTACT_PATTERNS.some((pattern) => pattern.test(message))) {
    topics.add('relationship');
  }

  // Check for handoff signals
  if (/\b(менеджер|manager|human|person|готов|ready|начинаем|start)\b/i.test(message)) {
    topics.add('handoff');
  }

  return Array.from(topics);
}

/**
 * Extract entities from user message.
 */
function extractEntities(message: string): Record<string, string> {
  const entities: Record<string, string> = {};

  // Extract budget mentions
  const budgetMatch = message.match(/(\$|€|£|USD|EUR|\d[\d\s,]*\s*(тыс|тысяч|тис|k|hundred|thousand))/i);
  if (budgetMatch) {
    entities.budgetHint = budgetMatch[0];
  }

  // Extract timeline mentions
  const timelineMatch = message.match(/(\d+\s*(нед|недель|тижн|week|month|мес|міс)|asap|срочно|терміново)/i);
  if (timelineMatch) {
    entities.timelineHint = timelineMatch[0];
  }

  // Extract service type mentions
  for (const [serviceKey, patterns] of Object.entries(SERVICE_KEYWORDS)) {
    if (patterns.some((pattern) => pattern.test(message))) {
      entities.serviceType = serviceKey;
      break;
    }
  }

  // Extract contact info
  const emailMatch = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    entities.email = emailMatch[0];
  }

  const phoneMatch = message.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch) {
    entities.phone = phoneMatch[0];
  }

  return entities;
}

/**
 * Calculate confidence score for intent detection.
 */
function calculateConfidence(
  intentType: UserIntentType,
  sentiment: UserSentiment,
  messageLength: number
): number {
  let confidence = 0.5;

  // Longer messages tend to have clearer intent
  if (messageLength > 50) {
    confidence += 0.15;
  } else if (messageLength > 20) {
    confidence += 0.08;
  }

  // Strong sentiment signals increase confidence
  if (sentiment === 'urgent' || sentiment === 'frustrated') {
    confidence += 0.15;
  } else if (sentiment === 'positive') {
    confidence += 0.1;
  }

  // Certain intent types are more confident
  if (intentType === 'commitment' || intentType === 'handoff_request') {
    confidence += 0.15;
  } else if (intentType === 'question') {
    confidence += 0.1;
  }

  return Math.min(0.95, Math.max(0.3, confidence));
}

/**
 * Analyze user intent from message and conversation context.
 */
export function analyzeUserIntent(params: {
  message: string;
  historyLength: number;
  previousIntent?: UserIntent;
}): UserIntent {
  const {message, historyLength} = params;
  const trimmedMessage = message.trim();

  const intentType = detectIntentType(trimmedMessage, historyLength);
  const sentiment = detectSentiment(trimmedMessage);
  const topics = classifyTopics(trimmedMessage);
  const entities = extractEntities(trimmedMessage);
  const confidence = calculateConfidence(intentType, sentiment, trimmedMessage.length);

  const isExplorationMode = intentType === 'exploration' || 
    (intentType === 'question' && historyLength < 3) ||
    EXPLORATION_PATTERNS.some((pattern) => pattern.test(trimmedMessage));

  const isCommitmentSignal = intentType === 'commitment' || 
    intentType === 'handoff_request' ||
    COMMITMENT_PATTERNS.some((pattern) => pattern.test(trimmedMessage));

  return {
    type: intentType,
    sentiment,
    confidence,
    topics,
    entities,
    isExplorationMode,
    isCommitmentSignal
  };
}

/**
 * Check if user is in exploration mode (not ready for direct questions).
 */
export function isUserExploring(message: string): boolean {
  return EXPLORATION_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

/**
 * Check if user is showing commitment signals.
 */
export function isUserCommitted(message: string): boolean {
  return COMMITMENT_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

/**
 * Check if user is asking for handoff.
 */
export function isHandoffRequest(message: string): boolean {
  return /\b(менеджер|менеджер|manager|human|person|живой|живий|speaking to someone)\b/i.test(
    message.trim()
  );
}
