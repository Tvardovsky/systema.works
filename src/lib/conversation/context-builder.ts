import type {ChatMessage, Locale} from '@/types/lead';
import type {Channel} from '@/types/omnichannel';
import type {
  ConversationContext,
  EngagementMetrics,
  TopicThreadKey,
  UserIntent
} from './types';
import {analyzeUserIntent} from './intent-analyzer';
import {
  getAllThreads,
  initializeThreads,
  updateThread,
  getMostActiveThread,
  mergeThreads,
  getThreadsSummary
} from './topic-tracker';

/**
 * Extract entities from a single message.
 */
function extractMessageEntities(message: string): Record<string, string | string[]> {
  const entities: Record<string, string | string[]> = {};
  const trimmed = message.trim();

  // Budget extraction
  const budgetPatterns = [
    /(\$|€|£)\s*?(\d[\d\s,]*)/i,
    /(\d[\d\s,]*)\s*(тыс|тысяч|тис|k|hundred|thousand|million)/i,
    /бюджет[:\s]+([^\n.]+)/i,
    /budget[:\s]+([^\n.]+)/i
  ];

  for (const pattern of budgetPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      entities.budgetHint = match[0];
      break;
    }
  }

  // Timeline extraction
  const timelinePatterns = [
    /(\d+)\s*(нед|недель|тижн|week|месяц|міс|month)/i,
    /(\d+)\s*(квартал|quarter)/i,
    /asap|срочно|терміново|urgent/i,
    /до\s+([а-яa-z]+\s*\d+)/i,
    /deadline[:\s]+([^\n.]+)/i
  ];

  for (const pattern of timelinePatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      entities.timelineHint = match[0];
      break;
    }
  }

  // Service type extraction
  const serviceTypes: Record<string, RegExp[]> = {
    landing_website: [/\b(лендинг|landing|одностранич|односторінк)\b/i],
    web_app: [/\b(веб-приложен|вебзастосунок|web app|web application)\b/i],
    mobile_app: [/\b(мобильн|мобільн|mobile app|ios|android)\b/i],
    automation: [/\b(автоматизац|automat|crm|amo|bitrix|notion)\b/i],
    ai_assistant: [/\b(ai|ии|бот|chat|чат|assistant|асистент)\b/i],
    ui_ux: [/\b(ui|ux|дизайн|design|интерфейс|інтерфейс)\b/i],
    smm_growth: [/\b(smm|маркетинг|маркетинг|marketing|продвижен|просуван)\b/i],
    branding_logo: [/\b(бренд|brand|logo|логотип|айдентик)\b/i]
  };

  for (const [service, patterns] of Object.entries(serviceTypes)) {
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      entities.serviceType = service;
      break;
    }
  }

  // Primary goal extraction (look for goal-oriented phrases)
  const goalPatterns = [
    /нужн[оа]|потріб[енна]|need|want|хочу|бажаю\s+([^.!?]+)/i,
    /цель|мета|goal|задача|завдання[:\s]+([^.!?]+)/i,
    /для\s+([^.!?]*(?:лид|продаж|брон|заявок|lead|sale|booking))/i
  ];

  for (const pattern of goalPatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1] && match[1].length > 5 && match[1].length < 200) {
      entities.primaryGoal = match[1].trim();
      break;
    }
  }

  // Contact extraction
  const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    entities.email = emailMatch[0];
  }

  const phoneMatch = trimmed.match(/(\+?\d[\d\s().-]{7,}\d)/);
  if (phoneMatch) {
    entities.phone = phoneMatch[0];
  }

  const telegramMatch = trimmed.match(/@(?:telegram\s*:?\s*)?([a-zA-Z0-9_]{3,32})/);
  if (telegramMatch) {
    entities.telegramHandle = `@${telegramMatch[1]}`;
  }

  // Name extraction (after name indicators)
  const namePatterns = [
    /(?:меня зовут|моё имя|зовут|name is|i'm|i am)\s+([A-ZА-Я][a-zа-яёіїє'-]+)/i,
    /^([A-ZА-Я][a-zа-яёіїє'-]+),?\s*(?:,|$)/i
  ];

  for (const pattern of namePatterns) {
    const match = trimmed.match(pattern);
    if (match && match[1] && match[1].length >= 2 && match[1].length <= 40) {
      entities.fullName = match[1].trim();
      break;
    }
  }

  // Constraints extraction
  if (/\b(но|but|however|однако|але|проблема|проблема|constraint|ограничен|обмежен)\b/i.test(trimmed)) {
    const constraintMatch = trimmed.match(/(?:но|but|however|однако|але)\s+([^.!?]+)/i);
    if (constraintMatch) {
      entities.constraints = constraintMatch[1].trim();
    }
  }

  return entities;
}

/**
 * Calculate engagement level from conversation history.
 */
function calculateEngagementLevel(
  history: ChatMessage[],
  voluntaryDisclosures: number,
  userInitiatedQuestions: number
): 'low' | 'medium' | 'high' {
  const userMessages = history.filter((msg) => msg.role === 'user');
  const avgLength =
    userMessages.reduce((sum, msg) => sum + msg.content.length, 0) / (userMessages.length || 1);

  const score =
    (voluntaryDisclosures * 2) +
    (userInitiatedQuestions * 1.5) +
    (avgLength > 50 ? 2 : avgLength > 20 ? 1 : 0);

  if (score >= 6) {
    return 'high';
  }
  if (score >= 3) {
    return 'medium';
  }
  return 'low';
}

/**
 * Calculate message depth trend.
 */
function calculateMessageDepthTrend(history: ChatMessage[]): 'increasing' | 'stable' | 'decreasing' {
  const userMessages = history.filter((msg) => msg.role === 'user').map((msg) => msg.content.length);

  if (userMessages.length < 3) {
    return 'stable';
  }

  const recent3 = userMessages.slice(-3);
  const older3 = userMessages.slice(0, 3);

  const recentAvg = recent3.reduce((a, b) => a + b, 0) / recent3.length;
  const olderAvg = older3.reduce((a, b) => a + b, 0) / older3.length;

  const change = recentAvg - olderAvg;
  const percentChange = olderAvg > 0 ? change / olderAvg : 0;

  if (percentChange > 0.2) {
    return 'increasing';
  }
  if (percentChange < -0.2) {
    return 'decreasing';
  }
  return 'stable';
}

/**
 * Count voluntary disclosures in history.
 */
function countVoluntaryDisclosures(history: ChatMessage[]): number {
  let count = 0;
  let lastWasQuestion = false;

  for (const msg of history) {
    if (msg.role === 'assistant' && msg.content.includes('?')) {
      lastWasQuestion = true;
      continue;
    }

    if (msg.role === 'user') {
      const entities = extractMessageEntities(msg.content);
      const entityCount = Object.keys(entities).length;

      // If user shared info without being directly asked
      if (!lastWasQuestion && entityCount > 0) {
        count += entityCount;
      } else if (entityCount > 2) {
        count += 1;
      }
    }

    lastWasQuestion = msg.role === 'assistant' && msg.content.includes('?');
  }

  return count;
}

/**
 * Count user-initiated questions.
 */
function countUserQuestions(history: ChatMessage[]): number {
  return history.filter((msg) => msg.role === 'user' && msg.content.includes('?')).length;
}

/**
 * Build conversation context from history and current message.
 */
export function buildConversationContext(params: {
  locale: Locale;
  channel: Channel;
  message: string;
  history: ChatMessage[];
  previousContext?: ConversationContext;
}): ConversationContext {
  const {locale, channel, message, history, previousContext} = params;
  const turnNumber = history.length + 1;

  // Analyze current user intent
  const userIntent = analyzeUserIntent({
    message,
    historyLength: history.length,
    previousIntent: previousContext?.userIntent
  });

  // Extract entities from current message
  const messageEntities = extractMessageEntities(message);

  // Initialize or merge threads
  let threads = previousContext?.threads ?? initializeThreads(0);

  // Update threads based on detected topics and entities
  for (const topic of userIntent.topics) {
    if (Object.keys(messageEntities).length > 0) {
      threads[topic] = updateThread(threads[topic], messageEntities, turnNumber);
    }
  }

  // Determine active thread
  const activeThread = userIntent.topics.length > 0
    ? userIntent.topics[0]
    : getMostActiveThread(threads);

  // Calculate engagement metrics
  const voluntaryDisclosures = countVoluntaryDisclosures(history);
  const userInitiatedQuestions = countUserQuestions(history);
  const engagementLevel = calculateEngagementLevel(
    history,
    voluntaryDisclosures,
    userInitiatedQuestions
  );
  const messageDepthTrend = calculateMessageDepthTrend(history);

  return {
    threads,
    activeThread,
    userIntent,
    engagementLevel,
    voluntaryDisclosures,
    userInitiatedQuestions,
    messageDepthTrend,
    locale,
    channel
  };
}

/**
 * Update context with new turn data.
 */
export function updateConversationContext(
  previousContext: ConversationContext,
  newIntent: UserIntent,
  message: string,
  turnNumber: number
): ConversationContext {
  const messageEntities = extractMessageEntities(message);
  let threads = {...previousContext.threads};

  // Update threads based on new entities
  for (const topic of newIntent.topics) {
    if (Object.keys(messageEntities).length > 0) {
      threads[topic] = updateThread(threads[topic], messageEntities, turnNumber);
    }
  }

  // Update active thread
  const activeThread = newIntent.topics.length > 0
    ? newIntent.topics[0]
    : getMostActiveThread(threads);

  // Recalculate engagement
  const engagementLevel = previousContext.engagementLevel;

  return {
    ...previousContext,
    threads,
    activeThread,
    userIntent: newIntent,
    engagementLevel
  };
}

/**
 * Get context summary for persistence.
 */
export function getContextSummary(context: ConversationContext): Record<string, unknown> {
  return {
    activeThread: context.activeThread,
    engagementLevel: context.engagementLevel,
    voluntaryDisclosures: context.voluntaryDisclosures,
    userInitiatedQuestions: context.userInitiatedQuestions,
    messageDepthTrend: context.messageDepthTrend,
    threads: getThreadsSummary(context.threads),
    userIntent: {
      type: context.userIntent.type,
      sentiment: context.userIntent.sentiment,
      confidence: context.userIntent.confidence,
      topics: context.userIntent.topics
    }
  };
}

/**
 * Extract all captured entities from context.
 */
export function extractAllEntities(
  context: ConversationContext
): Record<string, string | string[]> {
  const allEntities: Record<string, string | string[]> = {};

  for (const thread of Object.values(context.threads)) {
    Object.assign(allEntities, thread.entities);
  }

  return allEntities;
}
