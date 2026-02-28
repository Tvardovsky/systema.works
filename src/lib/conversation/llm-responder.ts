import OpenAI from 'openai';
import {z} from 'zod';
import {zodResponseFormat} from 'openai/helpers/zod';
import type {Locale} from '@/types/lead';
import type {
  ConversationContext,
  TopicThreadKey,
  ThreadDepth,
  UserIntent
} from './types';
import {detectUserLanguage, isVeryShortMessage, isFrustratedMessage} from './language-detector';

/**
 * LLM Response configuration from environment.
 */
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini';
const CHAT_FALLBACK_MODEL = process.env.OPENAI_CHAT_FALLBACK_MODEL ?? 'gpt-3.5-turbo';
const CHAT_MAX_TOKENS = Math.max(100, Math.min(500, Number.parseInt(process.env.OPENAI_CHAT_MAX_TOKENS ?? '300', 10) || 300));
const CHAT_TIMEOUT_MS = Math.max(2000, Math.min(15000, Number.parseInt(process.env.OPENAI_CHAT_TIMEOUT_MS ?? '5000', 10) || 5000));
const OPENAI_MAX_RETRIES = Math.max(0, Number.parseInt(process.env.OPENAI_MAX_RETRIES ?? '1', 10) || 1);

/**
 * OpenAI client for chat responses.
 */
const chatClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT_ID || undefined,
      organization: process.env.OPENAI_ORG_ID || undefined,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: CHAT_TIMEOUT_MS
    })
  : null;

/**
 * Structured LLM response schema.
 */
const llmResponseSchema = z.object({
  /** Acknowledgment of user's message (1 sentence) */
  acknowledgment: z.string().min(5).max(150),
  /** Value-add: insight, expertise, or options (1-2 sentences) */
  valueAdd: z.string().min(10).max(300),
  /** Optional exploration invite or question (0-1 questions) */
  explorationInvite: z.string().min(0).max(200),
  /** Whether to ask a question this turn */
  shouldAskQuestion: z.boolean()
});

/**
 * LLM response output type.
 */
export type LLMResponse = z.infer<typeof llmResponseSchema>;

/**
 * Input for LLM response generation.
 */
export interface LLMResponderInput {
  locale: Locale;
  message: string;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
  context: ConversationContext;
  activeThread: TopicThreadKey | null;
  threadDepth: ThreadDepth;
  isExplorationMode: boolean;
  isCommitmentSignal: boolean;
  turnNumber: number;
  conversationId?: string;
}

/**
 * Build system prompt for the LLM.
 */
function buildSystemPrompt(locale: Locale, message: string, history: Array<{role: string; content: string}>): string {
  // Detect user's actual language from current message
  const detectedLocale = detectUserLanguage(message, history);
  const languageName = detectedLocale === 'ru' ? 'Russian' : detectedLocale === 'uk' ? 'Ukrainian' : detectedLocale === 'sr-ME' ? 'Montenegrin' : 'English';
  
  // Check if user message is very short
  const userMessageShort = isVeryShortMessage(message);
  
  // Check if user seems frustrated
  const userFrustrated = isFrustratedMessage(message, detectedLocale);

  return [
    `You are SYSTEMA.WORKS sales AI assistant for a digital agency.`,
    ``,
    `LANGUAGE RULE (CRITICAL):`,
    `Respond in the SAME LANGUAGE as the user's CURRENT message.`,
    `Detected user language: ${languageName}`,
    `If user writes in Russian → respond in Russian`,
    `If user writes in English → respond in English`,
    `If user writes in Ukrainian → respond in Ukrainian`,
    `If user writes in Montenegrin → respond in Montenegrin`,
    ``,
    `RESPONSE LENGTH:`,
    userMessageShort 
      ? `- User message is VERY SHORT → Keep your response to 1 sentence max`
      : `- User message is normal length → Keep your response to 1-2 sentences max`,
    `- Max 1 question per turn (0 if user seems frustrated)`,
    userFrustrated
      ? `- User seems FRUSTRATED → Be extra brief, NO questions, just acknowledge and help`
      : `- Be concise and direct`,
    `- Max 150 characters (200 if complex topic)`,
    ``,
    `RESPONSE STRUCTURE:`,
    `- acknowledgment: Show you understood (3-10 words)`,
    `- valueAdd: Add value OR ask for missing info (10-80 characters)`,
    `- explorationInvite: Optional question ONLY if appropriate (0-50 characters)`,
    ``,
    `WHEN TO ASK QUESTIONS:`,
    `- Turn 1-2: NO questions (build rapport)`,
    `- Turn 3+: Max 1 question per 2 turns`,
    `- User frustrated: NO questions`,
    `- User message very short: NO questions`,
    `- Handoff ready: Ask for contact info`,
    ``,
    `AVOID:`,
    `- "I understand" (overused - use variations)`,
    `- "Could you share" (too formal)`,
    `- "What specific" (repetitive)`,
    `- Long paragraphs`,
    `- Multiple questions`,
    ``,
    `HANDOFF RULE:`,
    `- If user asks for manager AND contact is captured → Confirm and END conversation`,
    `- Response: "Менеджер с вами свяжется в ближайшее время" / "Manager will contact you soon"`,
    `- Set shouldAskQuestion: false`,
    ``,
    `OUTPUT: Return JSON only with keys: acknowledgment, valueAdd, explorationInvite, shouldAskQuestion`
  ].join('\n');
}

/**
 * Build developer prompt with task specifics.
 */
function buildDeveloperPrompt(): string {
  return [
    `JSON OUTPUT REQUIREMENTS:`,
    `- acknowledgment: 5-150 characters, show understanding`,
    `- valueAdd: 10-300 characters, provide expertise or options`,
    `- explorationInvite: 0-200 characters, question to move toward qualification`,
    `- shouldAskQuestion: boolean, true when ready to escalate`,
    ``,
    `ESCALATION GUIDANCE:`,
    `- Turn 1-2: Build rapport, ask about their needs`,
    `- Turn 3-4: Show expertise, start qualification`,
    `- Turn 5+: Ask for contact info to proceed`,
    `- Be proactive: don't wait forever to ask for contact`,
    ``,
    `AVOID:`,
    `- Generic acknowledgments like "Понял" without context`,
    `- Multiple questions in one turn`,
    `- Long paragraphs (keep concise)`,
    `- Repeating exact phrases from previous turns`,
    `- Being too passive - drive toward qualification`
  ].join('\n');
}

/**
 * Build user prompt with conversation context.
 */
function buildUserPrompt(params: LLMResponderInput): string {
  const {locale, message, history, context, activeThread, threadDepth, isExplorationMode, isCommitmentSignal, turnNumber} = params;

  // Get recent history (last 6 turns)
  const recentHistory = history.slice(-6);
  const historyText = recentHistory.length > 0
    ? recentHistory.map((item) => `${item.role}: ${item.content}`).join('\n')
    : '(no previous messages)';

  // Get thread context
  const threadContext = activeThread && context.threads[activeThread]
    ? {
        thread: activeThread,
        depth: threadDepth,
        entities: context.threads[activeThread].entities
      }
    : null;

  // Build context summary
  const contextParts: string[] = [];

  if (threadContext) {
    contextParts.push(`Active topic: ${threadContext.thread} (depth: ${threadContext.depth})`);
    const entities = Object.entries(threadContext.entities);
    if (entities.length > 0) {
      contextParts.push(`Captured details: ${entities.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(', ')}`);
    }
  }

  // Engagement signals
  if (context.engagementLevel !== 'low') {
    contextParts.push(`Engagement level: ${context.engagementLevel}`);
  }
  if (context.voluntaryDisclosures > 0) {
    contextParts.push(`Voluntary info shared: ${context.voluntaryDisclosures} times`);
  }

  const contextSummary = contextParts.length > 0
    ? contextParts.join('\n')
    : '(no additional context)';

  // Decision hints with escalation context
  const decisionHints: string[] = [];
  
  // Escalation based on turn count
  if (turnNumber <= 2) {
    decisionHints.push(`Turn ${turnNumber}: Build rapport, understand their needs`);
  } else if (turnNumber <= 4) {
    decisionHints.push(`Turn ${turnNumber}: Show expertise, start qualification (timeline/budget)`);
  } else {
    decisionHints.push(`Turn ${turnNumber}: Time to ask for contact info to proceed`);
  }
  
  if (isExplorationMode) {
    decisionHints.push('User is in exploration mode - build rapport first');
  }
  if (isCommitmentSignal) {
    decisionHints.push('User shows commitment - ask for contact info now');
  }
  if (threadDepth === 'surface') {
    decisionHints.push('Context is surface-level - explore more before asking');
  }
  if (threadDepth === 'detailed' || threadDepth === 'decision_ready') {
    decisionHints.push('Context is detailed - ask for contact to proceed');
  }

  const decisionGuidance = decisionHints.length > 0
    ? `DECISION GUIDANCE:\n${decisionHints.join('\n')}`
    : '';

  return [
    `Locale: ${locale}`,
    `Conversation turn: ${turnNumber}`,
    ``,
    `CONVERSATION CONTEXT:`,
    contextSummary,
    ``,
    `RECENT HISTORY:`,
    historyText,
    ``,
    `CURRENT USER MESSAGE:`,
    message,
    ``,
    decisionGuidance,
    ``,
    `Generate natural response in ${locale === 'ru' ? 'Russian' : locale === 'uk' ? 'Ukrainian' : locale === 'sr-ME' ? 'Montenegrin' : 'English'}.`
  ].filter(Boolean).join('\n\n');
}

/**
 * Call LLM to generate response.
 */
async function callLLM(params: {
  model: string;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  conversationId?: string;
}): Promise<LLMResponse | null> {
  if (!chatClient) {
    return null;
  }
  
  try {
    const completion = await chatClient.chat.completions.parse({
      model: params.model,
      messages: [
        {role: 'system', content: params.systemPrompt},
        {role: 'developer', content: params.developerPrompt},
        {role: 'user', content: params.userPrompt}
      ],
      response_format: zodResponseFormat(llmResponseSchema, 'conversational_response'),
      max_completion_tokens: CHAT_MAX_TOKENS
    }, {
      timeout: CHAT_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES
    });
    
    const parsed = completion.choices[0]?.message?.parsed;
    
    if (parsed) {
      console.info('[conversation-llm] response generated', {
        conversationId: params.conversationId ?? 'unknown',
        model: params.model,
        inputTokens: completion.usage?.prompt_tokens ?? null,
        outputTokens: completion.usage?.completion_tokens ?? null
      });
      return parsed;
    }
    
    return null;
  } catch (error) {
    console.warn('[conversation-llm] call failed, will fallback', {
      model: params.model,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Generate LLM-based conversational response.
 */
export async function generateLLMResponse(params: LLMResponderInput): Promise<LLMResponse | null> {
  const systemPrompt = buildSystemPrompt(params.locale, params.message, params.history);
  const developerPrompt = buildDeveloperPrompt();
  const userPrompt = buildUserPrompt(params);
  
  // Try primary model
  const primaryResponse = await callLLM({
    model: CHAT_MODEL,
    systemPrompt,
    developerPrompt,
    userPrompt,
    conversationId: params.conversationId
  });
  
  if (primaryResponse) {
    return primaryResponse;
  }
  
  // Try fallback model if different
  if (CHAT_FALLBACK_MODEL !== CHAT_MODEL) {
    const fallbackResponse = await callLLM({
      model: CHAT_FALLBACK_MODEL,
      systemPrompt,
      developerPrompt,
      userPrompt,
      conversationId: params.conversationId
    });
    
    if (fallbackResponse) {
      return fallbackResponse;
    }
  }
  
  return null;
}

/**
 * Check if LLM client is available.
 */
export function isLLMAvailable(): boolean {
  return chatClient !== null;
}

/**
 * Get current model configuration.
 */
export function getLLMConfig(): {
  primaryModel: string;
  fallbackModel: string;
  maxTokens: number;
  timeoutMs: number;
} {
  return {
    primaryModel: CHAT_MODEL,
    fallbackModel: CHAT_FALLBACK_MODEL,
    maxTokens: CHAT_MAX_TOKENS,
    timeoutMs: CHAT_TIMEOUT_MS
  };
}
