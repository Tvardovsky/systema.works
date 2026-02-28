import type {Locale} from '@/types/lead';
import type {Channel} from '@/types/omnichannel';
import type {ChatMessage} from '@/types/lead';
import type {
  ConversationalInput,
  ConversationalTurn,
  ConversationContext,
  TopicThreadKey
} from './types';
import {buildConversationContext, updateConversationContext, getContextSummary} from './context-builder';
import {composeConversationalResponse, composeScenarioResponse} from './response-composer';
import {detectHandoffSignal, calculateLeadIntentScore, markHandoffComplete} from './handoff-detector';
import {initializeThreads, getMostActiveThread, updateThread, promoteThreadDepth} from './topic-tracker';
import {analyzeUserIntent} from './intent-analyzer';
import {extractBriefFromConversation, shouldExtractBrief} from './brief-extractor';
import type {BriefExtractionResult, MergedBrief} from './brief-types';
import {detectRudenessLevel, getWittyResponse} from './witty-responses';

/**
 * Brief extraction configuration.
 */
const BRIEF_EXTRACTION_INTERVAL = 2; // Extract every 2+ turns
const BRIEF_EXTRACTION_MIN_CONFIDENCE = 0.5; // Only store fields with confidence >= 50%
const MIN_TURN_FOR_EXTRACTION = 2; // Start extraction from turn 2

/**
 * Get variation seed for response diversity.
 */
function getVariationSeed(conversationId?: string, turnNumber?: number): number {
  if (!conversationId) {
    return turnNumber ?? 0;
  }
  const hash = conversationId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return (hash + (turnNumber ?? 0)) % 5;
}

/**
 * Handle scope clarification when topic is unclear.
 */
function handleScopeClarification(
  locale: Locale,
  message: string,
  context: ConversationContext
): ConversationalTurn {
  const turnNumber = context.voluntaryDisclosures + context.userInitiatedQuestions + 1;
  const variationSeed = getVariationSeed(undefined, turnNumber);

  // Check if message has any scope keywords
  const hasScopeKeywords = /[а-яa-z]{4,}/i.test(message) && message.length > 10;

  let responseText: string;
  let nextThread: TopicThreadKey | undefined = undefined;

  if (hasScopeKeywords) {
    // User provided some context, acknowledge and explore
    responseText = composeScenarioResponse({
      locale,
      scenario: 'exploration'
    });
    nextThread = 'project_scope';
  } else {
    // Still unclear, ask for clarification
    responseText = composeScenarioResponse({
      locale,
      scenario: 'scope_clarify'
    });
  }

  return {
    response: {
      acknowledgment: locale === 'ru' ? 'Понял.' : locale === 'uk' ? 'Зрозумів.' : locale === 'sr-ME' ? 'Razumio sam.' : 'I see.',
      valueAdd: undefined,
      explorationInvite: undefined,
      shouldAskQuestion: false,
      nextThread
    },
    context,
    updatedThreads: context.threads,
    handoffReady: false,
    leadIntentScore: calculateLeadIntentScore(context),
    diagnostics: {
      intentType: context.userIntent.type,
      sentiment: context.userIntent.sentiment,
      activeThread: context.activeThread,
      questionsCount: 0
    }
  };
}

/**
 * Handle handoff scenario.
 */
function handleHandoff(
  locale: Locale,
  context: ConversationContext,
  message: string,
  turnNumber: number
): ConversationalTurn {
  const variationSeed = getVariationSeed(undefined, turnNumber);
  const handoffSignal = detectHandoffSignal({context, message});

  let responseText: string;
  let shouldAskContact = false;

  if (handoffSignal.missingInfo.includes('contact') || handoffSignal.missingInfo.includes('fullName')) {
    // Need contact info before handoff
    responseText = composeScenarioResponse({
      locale,
      scenario: 'handoff_ready'
    });
    shouldAskContact = true;
  } else {
    // Ready for full handoff
    responseText = locale === 'ru'
      ? 'Отлично, передаю менеджеру. Коллеги свяжутся в ближайшее время.'
      : locale === 'uk'
      ? 'Чудово, передаю менеджеру. Колеги зв\'яжуться найближчим часом.'
      : locale === 'sr-ME'
      ? 'Odlično, prosleđujem menadžeru. Kolege će vas kontaktirati uskoro.'
      : 'Great, I am handing this to a manager. Colleagues will contact you soon.';
  }

  const updatedContext = markHandoffComplete(context, turnNumber);

  return {
    response: {
      acknowledgment: locale === 'ru' ? 'Отлично!' : locale === 'uk' ? 'Чудово!' : locale === 'sr-ME' ? 'Odlično!' : 'Great!',
      valueAdd: undefined,
      explorationInvite: shouldAskContact ? responseText : undefined,
      question: shouldAskContact ? responseText : undefined,
      shouldAskQuestion: shouldAskContact,
      nextThread: 'handoff',
      handoffSignal: true
    },
    context: updatedContext,
    updatedThreads: updatedContext.threads,
    handoffReady: !shouldAskContact,
    leadIntentScore: calculateLeadIntentScore(updatedContext),
    diagnostics: {
      intentType: 'handoff_request',
      sentiment: context.userIntent.sentiment,
      activeThread: 'handoff',
      questionsCount: shouldAskContact ? 1 : 0
    }
  };
}

/**
 * Handle witty response to rudeness/profanity.
 */
function handleWittyResponse(
  locale: Locale,
  message: string,
  context: ConversationContext,
  turnNumber: number,
  rudenessLevel: import('./witty-responses').WitCategory
): ConversationalTurn {
  const wittyResponse = getWittyResponse(rudenessLevel, locale);
  
  return {
    response: {
      acknowledgment: '',
      valueAdd: wittyResponse,
      explorationInvite: undefined,
      question: undefined,
      shouldAskQuestion: false,
      nextThread: context.activeThread ?? undefined,
      handoffSignal: false
    },
    context,
    updatedThreads: context.threads,
    handoffReady: false,
    leadIntentScore: calculateLeadIntentScore(context),
    diagnostics: {
      intentType: context.userIntent.type,
      sentiment: context.userIntent.sentiment,
      activeThread: context.activeThread,
      questionsCount: 0
    }
  };
}

/**
 * Handle immediate handoff - contact captured, end conversation.
 */
function handleImmediateHandoff(
  locale: Locale,
  context: ConversationContext,
  message: string,
  turnNumber: number
): ConversationalTurn {
  // First ask if we can help with anything else
  const canHelpQuestion = locale === 'ru'
    ? 'Можем ли мы еще чем-то помочь перед передачей менеджеру?'
    : locale === 'uk'
    ? 'Чи можемо ми ще чимось допомогти перед передачею менеджеру?'
    : locale === 'sr-ME'
    ? 'Možemo li još nečim pomoći prije proslijeđivanja menadžeru?'
    : 'Can we help you with anything else before connecting you with a manager?';

  const finalMessage = locale === 'ru'
    ? `Спасибо! Менеджер с вами свяжется в ближайшее время. ${canHelpQuestion}`
    : locale === 'uk'
    ? `Дякуємо! Менеджер зв'яжеться з вами найближчим часом. ${canHelpQuestion}`
    : locale === 'sr-ME'
    ? `Hvala! Menadžer će vas kontaktirati uskoro. ${canHelpQuestion}`
    : `Thanks! A manager will contact you soon. ${canHelpQuestion}`;

  const updatedContext = markHandoffComplete(context, turnNumber);

  return {
    response: {
      acknowledgment: locale === 'ru' ? 'Понял!' : locale === 'uk' ? 'Зрозумів!' : locale === 'sr-ME' ? 'Razumio sam!' : 'Got it!',
      valueAdd: finalMessage,
      explorationInvite: undefined,
      question: undefined,
      shouldAskQuestion: false,
      nextThread: 'handoff',
      handoffSignal: true
    },
    context: updatedContext,
    updatedThreads: updatedContext.threads,
    handoffReady: true,
    leadIntentScore: calculateLeadIntentScore(updatedContext),
    diagnostics: {
      intentType: 'handoff_request',
      sentiment: context.userIntent.sentiment,
      activeThread: 'handoff',
      questionsCount: 0
    }
  };
}

/**
 * Handle contact collection - first handoff request.
 */
function handleContactCollection(
  locale: Locale,
  context: ConversationContext,
  message: string,
  turnNumber: number
): ConversationalTurn {
  const contactRequest = locale === 'ru'
    ? 'Конечно! Чтобы менеджер мог связаться, оставьте ваш контакт (email или телефон).'
    : locale === 'uk'
    ? 'Звичайно! Щоб менеджер міг зв\'язатися, залиште ваш контакт (email або телефон).'
    : locale === 'sr-ME'
    ? 'Naravno! Da bi menadžer mogao da vas kontaktira, ostavite svoj kontakt (email ili telefon).'
    : 'Of course! To connect you with a manager, please leave your contact (email or phone).';

  return {
    response: {
      acknowledgment: locale === 'ru' ? 'Понял!' : locale === 'uk' ? 'Зрозумів!' : locale === 'sr-ME' ? 'Razumio sam!' : 'Got it!',
      valueAdd: contactRequest,
      explorationInvite: undefined,
      question: undefined,
      shouldAskQuestion: false,
      nextThread: 'relationship',
      handoffSignal: false
    },
    context,
    updatedThreads: context.threads,
    handoffReady: false,
    leadIntentScore: calculateLeadIntentScore(context),
    diagnostics: {
      intentType: 'handoff_request',
      sentiment: context.userIntent.sentiment,
      activeThread: 'relationship',
      questionsCount: 0
    }
  };
}

/**
 * Main conversational turn handler.
 */
export async function runConversationalTurn(input: ConversationalInput): Promise<ConversationalTurn> {
  const {locale, channel, message, history, previousContext, conversationId} = input;
  const turnNumber = history.length + 1;
  const variationSeed = getVariationSeed(conversationId, turnNumber);

  // Build or update context
  const context = previousContext
    ? updateConversationContext(
        previousContext,
        analyzeUserIntent({message, historyLength: history.length}),
        message,
        turnNumber
      )
    : buildConversationContext({locale, channel, message, history});

  // Check for scope clarification needed (very first message, too short)
  if (turnNumber === 1 && message.trim().length < 8) {
    return handleScopeClarification(locale, message, context);
  }

  // Check for rudeness/profanity and respond with wit
  const rudenessLevel = detectRudenessLevel(message);
  if (rudenessLevel) {
    return handleWittyResponse(locale, message, context, turnNumber, rudenessLevel);
  }

  // Check for handoff signals with contact info
  const contactCaptured = !!(
    context.threads.relationship.entities.email ||
    context.threads.relationship.entities.phone ||
    context.threads.relationship.entities.telegramHandle
  );
  
  const handoffRequestCount = context.threads.handoff.lastActiveAt || 0;
  
  const handoffSignal = detectHandoffSignal({
    context,
    message,
    handoffRequestCount,
    contactCaptured
  });
  
  // Handle immediate handoff (contact captured OR 2nd+ request)
  if (handoffSignal.shouldEndConversation) {
    return handleImmediateHandoff(locale, context, message, turnNumber);
  }
  
  // Handle contact collection (first handoff request)
  if (handoffSignal.shouldAskForContact) {
    return handleContactCollection(locale, context, message, turnNumber);
  }
  
  if (handoffSignal.isReady || context.userIntent.type === 'handoff_request') {
    return handleHandoff(locale, context, message, turnNumber);
  }

  // Get active thread
  const activeThread = context.activeThread;
  const thread = activeThread ? context.threads[activeThread] : null;

  // Build synthetic history for LLM
  const syntheticHistory = history
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({role: item.role as 'user' | 'assistant', content: item.content}));

  // Compose natural response using LLM
  const composedResponse = await composeConversationalResponse({
    locale,
    intent: context.userIntent,
    activeThread,
    thread,
    turnNumber,
    history: syntheticHistory.slice(-6),
    context,
    variationSeed
  });

  // Update threads based on response
  let updatedThreads = {...context.threads};

  // If we captured entities, update the thread
  const entities = context.userIntent.entities;
  if (activeThread && Object.keys(entities).length > 0) {
    updatedThreads[activeThread] = updateThread(updatedThreads[activeThread], entities, turnNumber);
    updatedThreads[activeThread] = promoteThreadDepth(updatedThreads[activeThread]);
  }

  // Build final response text
  let responseText = composedResponse.acknowledgment;

  if (composedResponse.valueAdd) {
    responseText += ` ${composedResponse.valueAdd}`;
  }

  if (composedResponse.question) {
    responseText += ` ${composedResponse.question}`;
  }

  // Build updated context
  const updatedContext: ConversationContext = {
    ...context,
    threads: updatedThreads,
    activeThread: composedResponse.nextThread ?? activeThread
  };

  // Calculate lead intent scores for comparison
  const previousLeadScore = previousContext ? calculateLeadIntentScore(previousContext) : 0;
  const currentLeadScore = calculateLeadIntentScore(updatedContext);
  const leadScoreIncreased = currentLeadScore > previousLeadScore;

  // Get last extraction turn from context metadata
  const lastExtractionTurn = previousContext?.threads.handoff.lastActiveAt ?? 0;

  // Extract brief when:
  // 1. Every N turns (starting from turn 2)
  // 2. Lead score increased significantly (10+ points)
  // 3. User shows commitment signals
  let briefExtractionResult: BriefExtractionResult | null = null;
  let briefExtractionInfo: ConversationalTurn['briefExtraction'] = undefined;

  const shouldExtract = shouldExtractBrief({
    currentTurn: turnNumber,
    lastExtractionTurn,
    extractionInterval: BRIEF_EXTRACTION_INTERVAL,
    leadScoreIncreased,
    previousLeadScore,
    currentLeadScore
  });

  if (shouldExtract) {
    // Build existing brief from context for merging
    const existingBriefFromContext: MergedBrief | null = null; // Will be passed from API layer

    briefExtractionResult = await extractBriefFromConversation({
      locale,
      message,
      history: syntheticHistory,
      conversationId: conversationId ?? '',
      currentTurn: turnNumber,
      existingBrief: existingBriefFromContext
    });

    // Get fields that were updated (have value and confidence >= threshold)
    const fieldsUpdated: string[] = [];
    const fieldKeys = ['fullName', 'email', 'phone', 'telegramHandle', 'serviceType', 'primaryGoal', 'firstDeliverable', 'timelineHint', 'budgetHint', 'referralSource', 'constraints'] as const;

    for (const field of fieldKeys) {
      const value = briefExtractionResult.mergedBrief[field];
      const confidence = briefExtractionResult.mergedBrief.fieldConfidence[field] ?? 0;
      if (value !== null && confidence >= BRIEF_EXTRACTION_MIN_CONFIDENCE) {
        fieldsUpdated.push(field);
      }
    }

    briefExtractionInfo = {
      ran: true,
      turn: turnNumber,
      fieldsUpdated,
      completenessScore: briefExtractionResult.completeness.score,
      readyForHandoff: briefExtractionResult.completeness.readyForHandoff,
      leadScoreChange: leadScoreIncreased ? currentLeadScore - previousLeadScore : 0
    };
  }

  return {
    response: {
      ...composedResponse,
      acknowledgment: composedResponse.acknowledgment,
      valueAdd: composedResponse.valueAdd,
      explorationInvite: composedResponse.explorationInvite,
      question: composedResponse.question,
      shouldAskQuestion: composedResponse.shouldAskQuestion,
      nextThread: composedResponse.nextThread,
      handoffSignal: composedResponse.handoffSignal
    },
    context: updatedContext,
    updatedThreads,
    handoffReady: briefExtractionInfo?.readyForHandoff ?? false,
    leadIntentScore: calculateLeadIntentScore(updatedContext),
    diagnostics: {
      intentType: context.userIntent.type,
      sentiment: context.userIntent.sentiment,
      activeThread: composedResponse.nextThread ?? activeThread,
      questionsCount: composedResponse.shouldAskQuestion ? 1 : 0
    },
    briefExtraction: briefExtractionInfo
  };
}

/**
 * Initialize conversation context for new session.
 */
export function initializeConversationContext(
  locale: Locale,
  channel: Channel
): ConversationContext {
  return {
    threads: initializeThreads(0),
    activeThread: null,
    userIntent: {
      type: 'statement',
      sentiment: 'neutral',
      confidence: 0.5,
      topics: [],
      entities: {},
      isExplorationMode: true,
      isCommitmentSignal: false
    },
    engagementLevel: 'low',
    voluntaryDisclosures: 0,
    userInitiatedQuestions: 0,
    messageDepthTrend: 'stable',
    locale,
    channel
  };
}

/**
 * Get conversation summary for persistence.
 */
export function getConversationSummary(context: ConversationContext): Record<string, unknown> {
  return {
    ...getContextSummary(context),
    leadIntentScore: calculateLeadIntentScore(context),
    handoffReady: detectHandoffSignal({
      context,
      message: ''
    }).isReady
  };
}

/**
 * Extract all captured entities for lead brief.
 */
export function extractCapturedEntities(context: ConversationContext): Record<string, string | null> {
  const entities: Record<string, string | null> = {
    serviceType: null,
    primaryGoal: null,
    firstDeliverable: null,
    timelineHint: null,
    budgetHint: null,
    fullName: null,
    email: null,
    phone: null,
    telegramHandle: null,
    referralSource: null,
    constraints: null
  };

  for (const thread of Object.values(context.threads)) {
    for (const [key, value] of Object.entries(thread.entities)) {
      if (value) {
        entities[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }
  }

  return entities;
}
