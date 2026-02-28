import type {Locale} from '@/types/lead';

/**
 * Language detection patterns with confidence scoring.
 */
const LANGUAGE_PATTERNS: Record<Locale, {patterns: RegExp[]; uniquePatterns: RegExp[]}> = {
  ru: {
    patterns: [
      /[а-яё]/i,
      /\b(что|как|где|когда|почему|зачем|нужно|хочу|могу|да|нет)\b/i,
      /\b(привет|здравствуйте|добрый|день|утро|вечер)\b/i
    ],
    uniquePatterns: [
      /[ыэъ]/i,
      /\b(вы|вам|ваш|себя|себе)\b/i
    ]
  },
  uk: {
    patterns: [
      /[а-яіїєґ]/i,
      /\b(що|як|де|коли|чому|навіщо|потрібно|хочу|можу|так|ні)\b/i,
      /\b(привіт|вітаю|добрий|день|ранок|вечір)\b/i
    ],
    uniquePatterns: [
      /[іїєґ]/i,
      /\b(ви|вам|ваш|себе|собі)\b/i
    ]
  },
  en: {
    patterns: [
      /[a-z]/i,
      /\b(what|how|where|when|why|need|want|can|yes|no)\b/i,
      /\b(hello|hi|good|morning|afternoon|evening)\b/i
    ],
    uniquePatterns: [
      /\b(the|and|that|with|have|from)\b/i
    ]
  },
  'sr-ME': {
    patterns: [
      /[a-zčćžšđ]/i,
      /\b(šta|sto|kako|gde|kada|zašto|treba|hoću|mogu|da|ne)\b/i,
      /\b(zdravo|ćao|dobar|dan|jutro|veče)\b/i
    ],
    uniquePatterns: [
      /[čćžšđ]/i,
      /\b(vi|vam|vaš|sebe|sebi)\b/i
    ]
  }
};

/**
 * Detect language from a single message.
 */
export function detectMessageLanguage(message: string): {locale: Locale; confidence: number} {
  const trimmed = message.trim().toLowerCase();
  
  if (!trimmed) {
    return {locale: 'en', confidence: 0};
  }
  
  const scores: Record<Locale, number> = {en: 0, ru: 0, uk: 0, 'sr-ME': 0};
  
  // Score each language
  for (const [locale, config] of Object.entries(LANGUAGE_PATTERNS) as Array<[Locale, typeof LANGUAGE_PATTERNS[Locale]]>) {
    let score = 0;
    
    // Check unique patterns first (high confidence indicators)
    for (const pattern of config.uniquePatterns) {
      if (pattern.test(trimmed)) {
        score += 3;
      }
    }
    
    // Check general patterns
    for (const pattern of config.patterns) {
      if (pattern.test(trimmed)) {
        score += 1;
      }
    }
    
    scores[locale] = score;
  }
  
  // Find winner
  let maxScore = 0;
  let winner: Locale = 'en';
  
  for (const [locale, score] of Object.entries(scores) as Array<[Locale, number]>) {
    if (score > maxScore) {
      maxScore = score;
      winner = locale;
    }
  }
  
  // Calculate confidence
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? maxScore / totalScore : 0;
  
  // Boost confidence if unique patterns matched
  const uniqueMatched = LANGUAGE_PATTERNS[winner].uniquePatterns.some(p => p.test(trimmed));
  const finalConfidence = uniqueMatched ? Math.min(1, confidence + 0.3) : confidence;
  
  return {
    locale: winner,
    confidence: finalConfidence
  };
}

/**
 * Detect language from multiple messages.
 */
export function detectLanguageFromMessages(messages: string[]): {locale: Locale; confidence: number} {
  if (messages.length === 0) {
    return {locale: 'en', confidence: 0};
  }
  
  const localeScores: Record<Locale, number> = {en: 0, ru: 0, uk: 0, 'sr-ME': 0};
  let totalConfidence = 0;
  let validMessages = 0;
  
  for (const message of messages) {
    const detection = detectMessageLanguage(message);
    if (detection.confidence > 0.5) {
      localeScores[detection.locale] += detection.confidence;
      totalConfidence += detection.confidence;
      validMessages++;
    }
  }
  
  if (validMessages === 0) {
    return {locale: 'en', confidence: 0};
  }
  
  // Find winner
  let maxScore = 0;
  let winner: Locale = 'en';
  
  for (const [locale, score] of Object.entries(localeScores) as Array<[Locale, number]>) {
    if (score > maxScore) {
      maxScore = score;
      winner = locale;
    }
  }
  
  const avgConfidence = totalConfidence / validMessages;
  
  return {
    locale: winner,
    confidence: avgConfidence
  };
}

/**
 * Detect user's preferred language from current message and history.
 * Prioritizes current message, falls back to recent history.
 */
export function detectUserLanguage(
  currentMessage: string,
  history: Array<{role: string; content: string}>
): Locale {
  // Try current message first
  const currentDetection = detectMessageLanguage(currentMessage);
  if (currentDetection.confidence >= 0.6) {
    return currentDetection.locale;
  }
  
  // Fallback to recent user messages (last 3)
  const recentUserMessages = history
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content);
  
  if (recentUserMessages.length > 0) {
    const historyDetection = detectLanguageFromMessages(recentUserMessages);
    if (historyDetection.confidence >= 0.5) {
      return historyDetection.locale;
    }
  }
  
  // Default to English
  return 'en';
}

/**
 * Check if message is very short (1-3 words).
 */
export function isVeryShortMessage(message: string): boolean {
  const wordCount = message.trim().split(/\s+/).length;
  const charCount = message.trim().length;
  return wordCount <= 3 || charCount <= 20;
}

/**
 * Check if message shows frustration or impatience.
 */
export function isFrustratedMessage(message: string, locale: Locale): boolean {
  const trimmed = message.toLowerCase();
  
  const frustrationPatterns: Record<Locale, RegExp[]> = {
    ru: [
      /\b(достаточно|хватит|прекрати|отстань|заебал|достал)\b/i,
      /\b(не хочу|не буду|уйду|ухожу)\b/i,
      /\b(слишком|много|долго|медленно)\b/i
    ],
    uk: [
      /\b(достатньо|годі|перестань|відстань)\b/i,
      /\b(не хочу|не буду|піду|йду)\b/i,
      /\b(занадто|багато|довго|повільно)\b/i
    ],
    en: [
      /\b(enough|stop|quit|leave|pissed|frustrated)\b/i,
      /\b(don't want|won't|leaving|go)\b/i,
      /\b(too much|too long|too slow)\b/i
    ],
    'sr-ME': [
      /\b(dosta|dovoljno|prestani|odstani)\b/i,
      /\b(neću|ne želim|idem|odlazim)\b/i,
      /\b(previše|predugo|presporo)\b/i
    ]
  };
  
  return frustrationPatterns[locale].some(pattern => pattern.test(trimmed));
}
