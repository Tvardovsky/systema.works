import type {Locale} from '@/types/lead';
import type {
  ConversationalResponse,
  UserIntent,
  UserIntentType,
  UserSentiment,
  TopicThreadKey,
  TopicThread,
  ThreadDepth
} from './types';
import {generateLLMResponse, isLLMAvailable} from './llm-responder';

/**
 * Locale-specific acknowledgment phrases (fallback when LLM unavailable).
 */
const ACKNOWLEDGMENTS: Record<Locale, Record<UserIntentType, string[]>> = {
  ru: {
    statement: ['Понял.', 'Ясно.', 'Принял.', 'Услышал.'],
    question: ['Хороший вопрос.', 'Понимаю ваш интерес.', 'Важный момент.'],
    request: ['Без проблем.', 'Сделаем.', 'Договорились.'],
    commitment: ['Отлично!', 'Супер!', 'Здорово!'],
    exploration: ['Понимаю.', 'Разумно.', 'Логично.'],
    clarification: ['Сейчас объясню.', 'Сейчас расскажу подробнее.', 'Хорошо, поясню.'],
    objection: ['Понимаю вашу обеспокоенность.', 'Хорошо, давайте разберёмся.', 'Важный момент.'],
    chitchat: ['🙂', 'Приятно!', 'Отлично!'],
    handoff_request: ['Без проблем.', 'Сейчас передам.', 'Хорошо.']
  },
  uk: {
    statement: ['Зрозумів.', 'Ясно.', 'Прийняв.', 'Почув.'],
    question: ['Гарне запитання.', 'Розумію ваш інтерес.', 'Важливий момент.'],
    request: ['Без проблем.', 'Зробимо.', 'Домовились.'],
    commitment: ['Чудово!', 'Супер!', 'Класно!'],
    exploration: ['Розумію.', 'Логічно.', 'Зрозуміло.'],
    clarification: ['Зараз поясню.', 'Зараз розповім детальніше.', 'Добре, поясню.'],
    objection: ['Розумію ваше занепокоєння.', 'Добре, давайте розберемося.', 'Важливий момент.'],
    chitchat: ['🙂', 'Приємно!', 'Чудово!'],
    handoff_request: ['Без проблем.', 'Зараз передам.', 'Добре.']
  },
  en: {
    statement: ['Got it.', 'Understood.', 'I see.', 'Thanks for sharing.'],
    question: ['Good question.', 'I understand your interest.', 'Important point.'],
    request: ['No problem.', "We'll do it.", 'Deal.'],
    commitment: ['Great!', 'Awesome!', 'Perfect!'],
    exploration: ['I understand.', 'Makes sense.', 'Fair enough.'],
    clarification: ['Let me explain.', 'I will share more details.', 'Let me clarify.'],
    objection: ['I understand your concern.', "Let's figure this out.", 'Important point.'],
    chitchat: ['🙂', 'Nice!', 'Great!'],
    handoff_request: ['No problem.', "I'll transfer you now.", 'Sure.']
  },
  'sr-ME': {
    statement: ['Razumio sam.', 'Jasno.', 'Primio sam.', 'Čuo sam.'],
    question: ['Dobro pitanje.', 'Razumijem vaše interesovanje.', 'Važan momenat.'],
    request: ['Bez problema.', 'Uradićemo.', 'Dogovoreno.'],
    commitment: ['Odlično!', 'Super!', 'Sjajno!'],
    exploration: ['Razumijem.', 'Logično.', 'Jasno.'],
    clarification: ['Objasniću odmah.', 'Reći ću više detalja.', 'Dobro, objasniću.'],
    objection: ['Razumijem vašu zabrinutost.', 'Dobro, hajde da razjasnimo.', 'Važan momenat.'],
    chitchat: ['🙂', 'Prijatno!', 'Odlično!'],
    handoff_request: ['Bez problema.', 'Odmah ću proslijediti.', 'Dobro.']
  }
};

/**
 * Value-add responses by topic (fallback when LLM unavailable).
 */
const VALUE_ADD: Record<Locale, Record<TopicThreadKey, string[]>> = {
  ru: {
    project_scope: [
      'Мы делаем такие проекты регулярно.',
      'Это наш профиль — есть опыт в этой нише.',
      'Подобные задачи уже реализовывали.'
    ],
    logistics: [
      'По срокам и бюджету сориентирую после деталей.',
      'Обычно такие проекты занимают от 2 до 6 недель.',
      'Бюджет зависит от функционала, обсудим детали.'
    ],
    relationship: [
      'Контакт зафиксировал.',
      'Свяжемся в ближайшее время.',
      'Менеджер свяжется для уточнения деталей.'
    ],
    handoff: [
      'Сейчас передам менеджеру.',
      'Коллеги свяжутся для следующего шага.',
      'Передаю всю информацию команде.'
    ]
  },
  uk: {
    project_scope: [
      'Робимо такі проєкти регулярно.',
      'Це наш профіль — є досвід у цій ніші.',
      'Подібні задачі вже реалізовували.'
    ],
    logistics: [
      'За термінами і бюджетом зорієнтую після деталей.',
      'Зазвичай такі проєкти займають від 2 до 6 тижнів.',
      'Бюджет залежить від функціоналу, обговоримо деталі.'
    ],
    relationship: [
      'Контакт зафіксував.',
      'Зв\'яжемося найближчим часом.',
      'Менеджер зв\'яжеться для уточнення деталей.'
    ],
    handoff: [
      'Зараз передам менеджеру.',
      'Колеги зв\'яжуться для наступного кроку.',
      'Передаю всю інформацію команді.'
    ]
  },
  en: {
    project_scope: [
      'We do projects like this regularly.',
      'This is our specialty — we have experience in this niche.',
      'We have already implemented similar tasks.'
    ],
    logistics: [
      'I will orient you on timing and budget after details.',
      'Usually such projects take from 2 to 6 weeks.',
      'Budget depends on functionality, let us discuss details.'
    ],
    relationship: [
      'Contact noted.',
      'We will get in touch soon.',
      'Manager will contact you to clarify details.'
    ],
    handoff: [
      'I will transfer you to a manager now.',
      'Colleagues will contact you for next steps.',
      'I am passing all information to the team.'
    ]
  },
  'sr-ME': {
    project_scope: [
      'Radimo ovakve projekte redovno.',
      'Ovo je naš profil — imamo iskustvo u ovoj niši.',
      'Već smo realizovali slične zadatke.'
    ],
    logistics: [
      'Orijentisaću vas za rokove i budžet nakon detalja.',
      'Obično ovakvi projekti traju od 2 do 6 nedelja.',
      'Budžet zavisi od funkcionalnosti, diskutovaćemo detalje.'
    ],
    relationship: [
      'Kontakt je zabilježen.',
      'Javićemo se uskoro.',
      'Menadžer će vas kontaktirati za detalje.'
    ],
    handoff: [
      'Odmah ću proslijediti menadžeru.',
      'Kolege će vas kontaktirati za sledeći korak.',
      'Prosleđujem sve informacije timu.'
    ]
  }
};

/**
 * Exploration invites by topic (fallback when LLM unavailable).
 */
const EXPLORATION_INVITES: Record<Locale, Record<TopicThreadKey, string[]>> = {
  ru: {
    project_scope: [
      'Расскажи подробнее, что для тебя важно?',
      'Есть ли конкретные примеры, которые нравятся?',
      'Какой функционал нужен в первую очередь?'
    ],
    logistics: [
      'Есть ли предпочтения по срокам?',
      'Ориентируешься на какой-то бюджет?',
      'Когда хотелось бы запуститься?'
    ],
    relationship: [
      'Как к тебе лучше обращаться?',
      'Где удобнее связаться?',
      'Предпочитаешь звонок или сообщение?'
    ],
    handoff: [
      'Готов передать менеджеру. Как к тебе обращаться?',
      'Можно передать коллегам. Где связаться?',
      'Передаю команде. Как с тобой связаться?'
    ]
  },
  uk: {
    project_scope: [
      'Розкажи детальніше, що для тебе важливо?',
      'Чи є конкретні приклади, які подобаються?',
      'Який функціонал потрібен у першу чергу?'
    ],
    logistics: [
      'Чи є переваги за термінами?',
      'Орієнтуєшся на якийсь бюджет?',
      'Коли хотілося б запуститися?'
    ],
    relationship: [
      'Як до тебе краще звертатися?',
      'Де зручніше зв\'язатися?',
      'Волієш дзвінок чи повідомлення?'
    ],
    handoff: [
      'Готовий передати менеджеру. Як до тебе звертатися?',
      'Можна передати колегам. Де зв\'язатися?',
      'Передаю команді. Як з тобою зв\'язатися?'
    ]
  },
  en: {
    project_scope: [
      'Tell me more about what is important for you?',
      'Are there specific examples you like?',
      'What functionality do you need first?'
    ],
    logistics: [
      'Any preferences on timing?',
      'Do you have a budget range in mind?',
      'When would you like to launch?'
    ],
    relationship: [
      'What is the best way to address you?',
      'Where is it convenient to reach you?',
      'Do you prefer a call or message?'
    ],
    handoff: [
      'Ready to transfer to a manager. What is your name?',
      'I can pass you to colleagues. Where to reach you?',
      'Passing to the team. How to contact you?'
    ]
  },
  'sr-ME': {
    project_scope: [
      'Reci mi više o tome šta ti je važno?',
      'Imaš li konkretne primjere koji ti se sviđaju?',
      'Koja funkcionalnost ti treba prvo?'
    ],
    logistics: [
      'Imaš li preferencije za rokove?',
      'Orijentišeš se na neki budžet?',
      'Kada bi htio da se pokreneš?'
    ],
    relationship: [
      'Kako da ti se najbolje obraćam?',
      'Gdje ti je najzgodnije da te kontaktiram?',
      'Više voliš poziv ili poruku?'
    ],
    handoff: [
      'Spreman sam da proslijedim menadžeru. Kako da ti se obraćam?',
      'Mogu da te proslijedim kolegama. Gdje da te kontaktiram?',
      'Proslijeđujem timu. Kako da te kontaktiram?'
    ]
  }
};

/**
 * Select acknowledgment based on intent and locale.
 */
function selectAcknowledgment(
  locale: Locale,
  intentType: UserIntentType,
  variationSeed = 0
): string {
  const options = ACKNOWLEDGMENTS[locale][intentType] ?? ACKNOWLEDGMENTS[locale].statement;
  return options[variationSeed % options.length];
}

/**
 * Select value-add based on topic and locale.
 */
function selectValueAdd(
  locale: Locale,
  topic: TopicThreadKey,
  variationSeed = 0
): string {
  const options = VALUE_ADD[locale][topic] ?? VALUE_ADD[locale].project_scope;
  return options[variationSeed % options.length];
}

/**
 * Select exploration invite based on topic and locale.
 */
function selectExplorationInvite(
  locale: Locale,
  topic: TopicThreadKey,
  variationSeed = 0
): string {
  const options = EXPLORATION_INVITES[locale][topic] ?? EXPLORATION_INVITES[locale].project_scope;
  return options[variationSeed % options.length];
}

/**
 * Determine if we should ask a question this turn.
 */
function shouldAskQuestion(params: {
  intent: UserIntent;
  activeThread: TopicThreadKey | null;
  threadDepth: ThreadDepth;
  isExplorationMode: boolean;
  turnNumber: number;
}): boolean {
  const {intent, activeThread, threadDepth, isExplorationMode, turnNumber} = params;

  // Never ask during exploration mode (first 2-3 turns)
  if (isExplorationMode || turnNumber <= 2) {
    return false;
  }

  // Don't ask if user is objecting or frustrated
  if (intent.type === 'objection' || intent.sentiment === 'frustrated') {
    return false;
  }

  // Don't ask if thread is at surface level
  if (threadDepth === 'surface') {
    return false;
  }

  // Ask if user shows commitment
  if (intent.isCommitmentSignal) {
    return true;
  }

  // Ask if thread is detailed and no open questions
  if (threadDepth === 'detailed' || threadDepth === 'decision_ready') {
    return true;
  }

  return false;
}

/**
 * Compose response using LLM when available, fallback to templates.
 */
export async function composeConversationalResponse(params: {
  locale: Locale;
  intent: UserIntent;
  activeThread: TopicThreadKey | null;
  thread: TopicThread | null;
  turnNumber: number;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
  context: import('./types').ConversationContext;
  variationSeed?: number;
}): Promise<ConversationalResponse> {
  const {locale, intent, activeThread, thread, turnNumber, history, context, variationSeed = 0} = params;
  const threadDepth: ThreadDepth = thread?.depth ?? 'surface';

  // Try LLM generation first
  if (isLLMAvailable()) {
    const llmResponse = await generateLLMResponse({
      locale,
      message: '', // Will be passed from orchestrator
      history,
      context,
      activeThread,
      threadDepth,
      isExplorationMode: intent.isExplorationMode,
      isCommitmentSignal: intent.isCommitmentSignal,
      turnNumber
    });

    if (llmResponse) {
      return {
        acknowledgment: llmResponse.acknowledgment,
        valueAdd: llmResponse.valueAdd || undefined,
        explorationInvite: llmResponse.shouldAskQuestion ? (llmResponse.explorationInvite || undefined) : undefined,
        question: llmResponse.shouldAskQuestion && llmResponse.explorationInvite ? llmResponse.explorationInvite : undefined,
        shouldAskQuestion: llmResponse.shouldAskQuestion,
        nextThread: activeThread ?? undefined,
        handoffSignal: intent.type === 'handoff_request' || intent.isCommitmentSignal
      };
    }
  }

  // Fallback to template-based response
  const acknowledgment = selectAcknowledgment(locale, intent.type, variationSeed);
  const shouldAsk = shouldAskQuestion({
    intent,
    activeThread,
    threadDepth,
    isExplorationMode: intent.isExplorationMode,
    turnNumber
  });

  const response: ConversationalResponse = {
    acknowledgment,
    shouldAskQuestion: shouldAsk
  };

  // Add value if we have an active thread
  if (activeThread && !intent.isExplorationMode) {
    response.valueAdd = selectValueAdd(locale, activeThread, variationSeed + 1);
  }

  // Add exploration invite if appropriate
  if (shouldAsk && activeThread) {
    response.explorationInvite = selectExplorationInvite(locale, activeThread, variationSeed + 2);
    response.question = response.explorationInvite;
    response.nextThread = activeThread;
  }

  // Handle handoff signals
  if (intent.type === 'handoff_request' || intent.isCommitmentSignal) {
    response.handoffSignal = true;
    if (activeThread !== 'handoff') {
      response.nextThread = 'handoff';
    }
  }

  // Handle objections with empathy
  if (intent.type === 'objection' || intent.sentiment === 'concerned') {
    response.valueAdd = locale === 'ru'
      ? 'Давайте разберёмся, что именно вызывает вопросы.'
      : locale === 'uk'
      ? 'Давайте розберемося, що саме викликає питання.'
      : locale === 'sr-ME'
      ? 'Hajde da razjasnimo šta tačno izaziva pitanja.'
      : 'Let us figure out what exactly raises questions.';
    response.shouldAskQuestion = false;
    response.question = undefined;
  }

  return response;
}

/**
 * Generate response for specific scenarios (template-based, no LLM).
 */
export function composeScenarioResponse(params: {
  locale: Locale;
  scenario: 'welcome' | 'scope_clarify' | 'handoff_ready' | 'objection_handling' | 'exploration';
  context?: Record<string, string>;
}): string {
  const {locale, scenario, context = {}} = params;

  const responses: Record<string, Record<Locale, string>> = {
    welcome: {
      ru: 'Привет! Расскажите о проекте — что нужно сделать?',
      uk: 'Привіт! Розкажіть про проєкт — що потрібно зробити?',
      en: 'Hello! Tell me about your project — what do you need to build?',
      'sr-ME': 'Pozdrav! Pričajte mi o projektu — šta treba da uradimo?'
    },
    scope_clarify: {
      ru: 'Уточните задачу одной фразой: какой продукт или услугу нужно сделать?',
      uk: 'Уточніть запит однією фразою: який продукт або послугу потрібно зробити?',
      en: 'Please clarify in one sentence: what product or service should we build?',
      'sr-ME': 'Pojasnite u jednoj rečenici: koji proizvod ili uslugu treba da uradimo?'
    },
    handoff_ready: {
      ru: 'Отлично, передаю менеджеру. Как к вам обращаться и где связаться?',
      uk: 'Чудово, передаю менеджеру. Як до вас звертатися і де зв\'язатися?',
      en: 'Great, I am handing this to a manager. What is your name and how to reach you?',
      'sr-ME': 'Odlično, prosleđujem menadžeru. Kako da vam se obraćam i gde da vas kontaktiram?'
    },
    objection_handling: {
      ru: 'Понимаю. Давайте обсудим, что можно адаптировать под ваши условия.',
      uk: 'Розумію. Давайте обговоримо, що можна адаптувати під ваші умови.',
      en: 'I understand. Let us discuss what can be adapted to your conditions.',
      'sr-ME': 'Razumijem. Hajde da diskutujemo šta može da se prilagodi vašim uslovima.'
    },
    exploration: {
      ru: 'Понимаю. Есть вопросы по проекту или просто изучаете варианты?',
      uk: 'Розумію. Є питання по проєкту чи просто вивчаєте варіанти?',
      en: 'I see. Do you have questions about the project or just exploring options?',
      'sr-ME': 'Razumijem. Imaš li pitanja o projektu ili samo istražuješ opcije?'
    }
  };

  return responses[scenario]?.[locale] ?? responses.welcome[locale];
}
