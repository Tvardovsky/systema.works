import type {DialogTopic, DialogTurnMode} from './types';

const QUESTION_START_HINTS = [
  'что', 'какой', 'какая', 'какие', 'когда', 'сколько', 'зачем', 'почему', 'как',
  'шо', 'що', 'який', 'яка', 'які', 'коли',
  'what', 'which', 'when', 'why', 'how', 'can', 'do', 'does', 'is', 'are',
  'šta', 'sto', 'koji', 'kada', 'kako', 'koliko', 'zašto', 'zasto'
];

const IN_SCOPE_HINTS = [
  'site', 'website', 'web', 'landing', 'app', 'mobile', 'ios', 'android', 'ui', 'ux',
  'automation', 'crm', 'pipeline', 'integration', 'api', 'ai', 'assistant', 'chatbot',
  'smm', 'ads', 'marketing', 'lead', 'conversion', 'sales',
  'сайт', 'лендинг', 'прилож', 'мобил', 'дизайн', 'интерфейс', 'автоматизац', 'crm', 'интеграц', 'бот',
  'смм', 'маркет', 'лид', 'конверс', 'продаж',
  'сайт', 'лендінг', 'додат', 'дизайн', 'автоматизац', 'інтеграц', 'лід',
  'sajt', 'aplikac', 'automatiz', 'integrac', 'dizajn', 'lead'
];

const OUT_OF_SCOPE_HINTS = [
  'weather', 'forecast', 'recipe', 'horoscope', 'lottery', 'sports score',
  'погода', 'рецепт', 'гороскоп', 'лотерея', 'курс валют',
  'погода', 'рецепт', 'гороскоп', 'лотерея',
  'vrijeme', 'recept', 'horoskop', 'lutrija'
];

function clean(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function isContactPayload(text: string): boolean {
  return (
    /@/.test(text)
    || /(?:^|\s)(?:email|e-mail|телефон|phone|telegram|телеграм|tg|t\.me\/)/i.test(text)
    || /\+?\d[\d\s\-()]{7,}/.test(text)
  );
}

function looksLikeQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('?')) {
    return true;
  }
  const firstToken = lower.split(/\s+/).find(Boolean) ?? '';
  return QUESTION_START_HINTS.some((hint) => firstToken.startsWith(hint));
}

function containsAny(text: string, hints: string[]): boolean {
  const lower = text.toLowerCase();
  return hints.some((hint) => lower.includes(hint));
}

export type UserIntent = {
  isQuestion: boolean;
  inScopeQuestion: boolean;
  outOfScopeQuestion: boolean;
  turnModeSuggestion: DialogTurnMode | null;
};

export function detectUserIntent(params: {
  message: string;
  topic: DialogTopic;
}): UserIntent {
  const message = clean(params.message);
  const isQuestion = looksLikeQuestion(message);
  const hasInScopeHint = containsAny(message, IN_SCOPE_HINTS);
  const hasOutOfScopeHint = containsAny(message, OUT_OF_SCOPE_HINTS);
  const contactPayload = isContactPayload(message);

  const outOfScopeQuestion = isQuestion && (params.topic === 'disallowed' || hasOutOfScopeHint);
  const inScopeQuestion = isQuestion
    && params.topic === 'allowed'
    && !hasOutOfScopeHint
    && !contactPayload
    && (hasInScopeHint || message.length >= 24);

  const turnModeSuggestion: DialogTurnMode | null = outOfScopeQuestion
    ? 'scope_clarify'
    : (inScopeQuestion ? 'answer_only' : null);

  return {
    isQuestion,
    inScopeQuestion,
    outOfScopeQuestion,
    turnModeSuggestion
  };
}
