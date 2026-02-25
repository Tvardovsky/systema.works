import type {ChatMessage, Locale} from '@/types/lead';
import type {DialogV2Plan} from './planner';
import type {DialogV2ResolveResult} from './resolve';

type ComposeInput = {
  locale: Locale;
  plan: DialogV2Plan;
  resolved: DialogV2ResolveResult;
  history: ChatMessage[];
};

const ACK_GENERIC: Record<Locale, string> = {
  ru: 'Понял.',
  uk: 'Зрозумів.',
  en: 'Understood.',
  'sr-ME': 'Razumio sam.'
};

const ACK_CONTACT: Record<Locale, string> = {
  ru: 'Контакт зафиксировал.',
  uk: 'Контакт зафіксував.',
  en: 'Contact noted.',
  'sr-ME': 'Kontakt je zabilježen.'
};

const ACK_SERVICE: Record<Locale, string> = {
  ru: 'Тип услуги зафиксировал.',
  uk: 'Тип послуги зафіксував.',
  en: 'Service type noted.',
  'sr-ME': 'Tip usluge je zabilježen.'
};

const ACK_GOAL: Record<Locale, string> = {
  ru: 'Цель проекта зафиксировал.',
  uk: 'Ціль проєкту зафіксував.',
  en: 'Project goal noted.',
  'sr-ME': 'Cilj projekta je zabilježen.'
};

const ACK_TIMELINE: Record<Locale, string> = {
  ru: 'Сроки зафиксировал.',
  uk: 'Строки зафіксував.',
  en: 'Timeline noted.',
  'sr-ME': 'Rok je zabilježen.'
};

const ACK_BUDGET: Record<Locale, string> = {
  ru: 'Ориентир по бюджету зафиксировал.',
  uk: 'Орієнтир бюджету зафіксував.',
  en: 'Budget range noted.',
  'sr-ME': 'Budžetski okvir je zabilježen.'
};

const ACK_WITH_VALUE: Record<Locale, {
  goal: (value: string) => string;
  timeline: (value: string) => string;
  budget: (value: string) => string;
  contact: (value: string) => string;
  service: (value: string) => string;
}> = {
  ru: {
    goal: (value) => `Цель понял: ${value}.`,
    timeline: (value) => `По срокам ориентир ${value}.`,
    budget: (value) => `По бюджету ориентир ${value}.`,
    contact: (value) => `Контакт принял: ${value}.`,
    service: (value) => `Понял, нужен ${value}.`
  },
  uk: {
    goal: (value) => `Ціль зрозумів: ${value}.`,
    timeline: (value) => `За термінами орієнтир ${value}.`,
    budget: (value) => `За бюджетом орієнтир ${value}.`,
    contact: (value) => `Контакт прийняв: ${value}.`,
    service: (value) => `Зрозумів, потрібен ${value}.`
  },
  en: {
    goal: (value) => `Goal captured: ${value}.`,
    timeline: (value) => `Timeline noted: ${value}.`,
    budget: (value) => `Budget range noted: ${value}.`,
    contact: (value) => `Contact captured: ${value}.`,
    service: (value) => `Got it, you need ${value}.`
  },
  'sr-ME': {
    goal: (value) => `Cilj je jasan: ${value}.`,
    timeline: (value) => `Rok je zabilježen: ${value}.`,
    budget: (value) => `Budžetski okvir je zabilježen: ${value}.`,
    contact: (value) => `Kontakt je primljen: ${value}.`,
    service: (value) => `Razumio sam, treba vam ${value}.`
  }
};

const SERVICE_TYPE_LABELS: Record<string, Record<Locale, string>> = {
  landing_website: {
    ru: 'лендинг',
    uk: 'лендинг',
    en: 'landing page',
    'sr-ME': 'landing stranica'
  },
  web_app: {
    ru: 'веб-приложение',
    uk: 'вебзастосунок',
    en: 'web app',
    'sr-ME': 'web aplikacija'
  },
  mobile_app: {
    ru: 'мобильное приложение',
    uk: 'мобільний застосунок',
    en: 'mobile app',
    'sr-ME': 'mobilna aplikacija'
  },
  automation: {
    ru: 'автоматизация',
    uk: 'автоматизація',
    en: 'automation',
    'sr-ME': 'automatizacija'
  },
  ai_assistant: {
    ru: 'AI-ассистент',
    uk: 'AI-асистент',
    en: 'AI assistant',
    'sr-ME': 'AI asistent'
  },
  ui_ux: {
    ru: 'UI/UX дизайн',
    uk: 'UI/UX дизайн',
    en: 'UI/UX design',
    'sr-ME': 'UI/UX dizajn'
  },
  smm_growth: {
    ru: 'SMM и рост',
    uk: 'SMM і ріст',
    en: 'SMM growth',
    'sr-ME': 'SMM rast'
  },
  branding_logo: {
    ru: 'брендинг и логотип',
    uk: 'брендинг і логотип',
    en: 'branding and logo',
    'sr-ME': 'brending i logo'
  }
};

const HANDOFF_MESSAGE: Record<Locale, string> = {
  ru: 'Бриф собран. Передаю менеджеру для следующего шага.',
  uk: 'Бриф зібрано. Передаю менеджеру для наступного кроку.',
  en: 'The brief is complete. I am handing this over to a manager for next steps.',
  'sr-ME': 'Brief je kompletan. Prosleđujem menadžeru za sledeći korak.'
};

const DISALLOWED_PREFIX: Record<Locale, string> = {
  ru: 'Работаем только в рамках цифровых услуг агентства.',
  uk: 'Працюємо лише в межах цифрових послуг агенції.',
  en: 'We can help only within digital agency services.',
  'sr-ME': 'Možemo pomoći samo u okviru digitalnih usluga agencije.'
};

function clean(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function clipValue(value: string | null | undefined, maxLength = 80): string | null {
  const cleaned = clean(value ?? '');
  if (!cleaned) {
    return null;
  }
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1)}…`;
}

function localizeServiceType(value: string | null | undefined, locale: Locale): string | null {
  const cleaned = clean(value ?? '');
  if (!cleaned) {
    return null;
  }
  return SERVICE_TYPE_LABELS[cleaned]?.[locale] ?? cleaned;
}

function humanizeTimelineValue(value: string | null | undefined, locale: Locale): string | null {
  const cleaned = clean(value ?? '');
  if (!cleaned) {
    return null;
  }
  if (cleaned === 'no_deadline') {
    if (locale === 'ru') return 'без жесткого дедлайна';
    if (locale === 'uk') return 'без жорсткого дедлайну';
    if (locale === 'sr-ME') return 'bez fiksnog roka';
    return 'without a fixed deadline';
  }
  if (cleaned === 'asap') {
    if (locale === 'ru') return 'как можно быстрее';
    if (locale === 'uk') return 'якнайшвидше';
    if (locale === 'sr-ME') return 'što prije';
    return 'as soon as possible';
  }
  if (cleaned.startsWith('duration:')) {
    const raw = cleaned.replace('duration:', '').replace(/_/g, ' ');
    return raw || cleaned;
  }
  if (cleaned.startsWith('date_range:')) {
    return cleaned.replace('date_range:', '').trim() || cleaned;
  }
  if (cleaned.startsWith('quarter:')) {
    return cleaned.replace('quarter:', '').toUpperCase();
  }
  if (cleaned.startsWith('free_text:')) {
    return cleaned.replace('free_text:', '').trim() || cleaned;
  }
  return cleaned;
}

function humanizeBudgetValue(value: string | null | undefined): string | null {
  const cleaned = clean(value ?? '');
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith('raw:')) {
    const rawPart = cleaned.match(/raw:\s*([^;]+)/i)?.[1]?.trim();
    if (rawPart) {
      return rawPart;
    }
  }
  if (cleaned.startsWith('normalized:')) {
    return cleaned.replace('normalized:', '').trim();
  }
  return cleaned;
}

function getAcknowledgement(params: {
  locale: Locale;
  resolved: DialogV2ResolveResult;
}): string {
  const {resolved, locale} = params;
  if (resolved.slots.contact.aggregate.updatedThisTurn && resolved.slots.contact.aggregate.state === 'confirmed') {
    const contactValue = clipValue(
      resolved.slots.contact.email.value
      ?? resolved.slots.contact.phone.value
      ?? resolved.slots.contact.telegramHandle.value
      ?? resolved.slots.contact.aggregate.value
    );
    return contactValue ? ACK_WITH_VALUE[locale].contact(contactValue) : ACK_CONTACT[locale];
  }
  if (resolved.slots.budget.updatedThisTurn && resolved.slots.budget.state === 'confirmed') {
    const budgetValue = clipValue(humanizeBudgetValue(resolved.slots.budget.value));
    return budgetValue ? ACK_WITH_VALUE[locale].budget(budgetValue) : ACK_BUDGET[locale];
  }
  if (resolved.slots.timeline.updatedThisTurn && resolved.slots.timeline.state === 'confirmed') {
    const timelineValue = clipValue(humanizeTimelineValue(resolved.slots.timeline.value, locale));
    return timelineValue ? ACK_WITH_VALUE[locale].timeline(timelineValue) : ACK_TIMELINE[locale];
  }
  if (resolved.slots.primaryGoal.updatedThisTurn && resolved.slots.primaryGoal.state !== 'unknown') {
    const goalValue = clipValue(resolved.slots.primaryGoal.value);
    return goalValue ? ACK_WITH_VALUE[locale].goal(goalValue) : ACK_GOAL[locale];
  }
  if (resolved.slots.serviceType.updatedThisTurn && resolved.slots.serviceType.state !== 'unknown') {
    const serviceValue = clipValue(localizeServiceType(resolved.slots.serviceType.value, locale));
    return serviceValue ? ACK_WITH_VALUE[locale].service(serviceValue) : ACK_SERVICE[locale];
  }
  return ACK_GENERIC[locale];
}

function ensureQuestionSuffix(answer: string, nextQuestion: string): string {
  const normalizedQuestion = clean(nextQuestion);
  if (!normalizedQuestion) {
    return clean(answer);
  }
  const normalizedAnswer = clean(answer);
  if (normalizedAnswer.toLowerCase().includes(normalizedQuestion.toLowerCase())) {
    return normalizedAnswer;
  }
  if (normalizedAnswer.endsWith('?')) {
    return `${normalizedAnswer} ${normalizedQuestion}`;
  }
  return `${normalizedAnswer} ${normalizedQuestion}`;
}

export function composeDialogV2Answer(params: ComposeInput): string {
  if (params.plan.topic === 'disallowed') {
    return ensureQuestionSuffix(
      `${DISALLOWED_PREFIX[params.locale]}`,
      params.plan.nextQuestion
    );
  }

  if (params.plan.topic === 'unclear') {
    return ensureQuestionSuffix(
      `${ACK_GENERIC[params.locale]}`,
      params.plan.nextQuestion
    );
  }

  if (params.plan.handoffReady && params.plan.nextSlot === 'handoff') {
    return HANDOFF_MESSAGE[params.locale];
  }

  const ack = getAcknowledgement({locale: params.locale, resolved: params.resolved});
  return ensureQuestionSuffix(ack, params.plan.nextQuestion);
}
