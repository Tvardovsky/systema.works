import OpenAI from 'openai';
import {zodResponseFormat} from 'openai/helpers/zod';
import {z} from 'zod';
import type {ChatMessage, Locale} from '@/types/lead';
import {
  extractLeadSignalsDeterministic,
  hasAreaSignal,
  hasExplicitBudgetSignal,
  type LeadSignals
} from '@/lib/lead-signals';

type BriefFieldKey =
  | 'fullName'
  | 'email'
  | 'phone'
  | 'telegramHandle'
  | 'serviceType'
  | 'primaryGoal'
  | 'firstDeliverable'
  | 'timelineHint'
  | 'budgetHint'
  | 'referralSource'
  | 'constraints';

export type BriefExtractionFields = Record<BriefFieldKey, string | null>;

export type BriefExtractionAmbiguity =
  | 'budget_vs_area'
  | 'timeline_unclear'
  | 'contact_unclear'
  | 'service_unclear';

export type BriefExtractionClarificationType = 'budget' | 'timeline' | 'contact' | 'service' | null;

export type BriefExtractionResult = {
  fields: BriefExtractionFields;
  evidence: Partial<Record<BriefFieldKey, string>>;
  confidence: Partial<Record<BriefFieldKey, number>>;
  ambiguities: BriefExtractionAmbiguity[];
  shouldAskClarification: boolean;
  clarificationType: BriefExtractionClarificationType;
  extractorUsed: boolean;
  extractorModel: string | null;
  deterministicFallback: boolean;
  deterministicSignals: LeadSignals;
  hasAreaContext: boolean;
};

const EXTRACT_MODEL = process.env.OPENAI_QUALITY_MODEL ?? 'gpt-5-mini';
const OPENAI_MAX_RETRIES = Math.max(0, Number.parseInt(process.env.OPENAI_MAX_RETRIES ?? '0', 10) || 0);
const EXTRACT_TIMEOUT_MS = Math.max(2500, Number.parseInt(process.env.OPENAI_EXTRACT_TIMEOUT_MS ?? '7000', 10) || 7000);
const EXTRACT_MAX_OUTPUT_TOKENS = Math.max(240, Number.parseInt(process.env.OPENAI_EXTRACT_MAX_OUTPUT_TOKENS ?? '700', 10) || 700);
const EXTRACT_HISTORY_WINDOW = Math.max(4, Number.parseInt(process.env.OPENAI_EXTRACT_HISTORY_WINDOW ?? '12', 10) || 12);
const EXTRACT_FAST_MAX_OUTPUT_TOKENS = Math.max(
  180,
  Number.parseInt(process.env.OPENAI_EXTRACT_FAST_MAX_OUTPUT_TOKENS ?? '380', 10) || 380
);
const EXTRACT_FAST_HISTORY_WINDOW = Math.max(
  3,
  Math.min(
    EXTRACT_HISTORY_WINDOW,
    Number.parseInt(process.env.OPENAI_EXTRACT_FAST_HISTORY_WINDOW ?? '6', 10) || 6
  )
);
const EXTRACT_CONFIDENCE_THRESHOLD = Math.max(0.5, Math.min(0.95, Number.parseFloat(process.env.OPENAI_EXTRACT_CONFIDENCE_THRESHOLD ?? '0.72') || 0.72));
const EXTRACT_RETRY_OUTPUT_TOKENS = Math.max(
  EXTRACT_MAX_OUTPUT_TOKENS + 250,
  Number.parseInt(process.env.OPENAI_EXTRACT_RETRY_MAX_OUTPUT_TOKENS ?? `${EXTRACT_MAX_OUTPUT_TOKENS + 250}`, 10) || EXTRACT_MAX_OUTPUT_TOKENS + 250
);
const EXTRACT_FAST_RETRY_OUTPUT_TOKENS = Math.max(
  EXTRACT_FAST_MAX_OUTPUT_TOKENS + 180,
  Number.parseInt(
    process.env.OPENAI_EXTRACT_FAST_RETRY_MAX_OUTPUT_TOKENS ?? `${EXTRACT_FAST_MAX_OUTPUT_TOKENS + 180}`,
    10
  ) || EXTRACT_FAST_MAX_OUTPUT_TOKENS + 180
);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT_ID || undefined,
      organization: process.env.OPENAI_ORG_ID || undefined,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: EXTRACT_TIMEOUT_MS
    })
  : null;

const nullableBriefFieldSchema = z.string().trim().max(1000).nullable();
const briefFieldsSchema = z.object({
  fullName: nullableBriefFieldSchema,
  email: nullableBriefFieldSchema,
  phone: nullableBriefFieldSchema,
  telegramHandle: nullableBriefFieldSchema,
  serviceType: nullableBriefFieldSchema,
  primaryGoal: nullableBriefFieldSchema,
  firstDeliverable: nullableBriefFieldSchema,
  timelineHint: nullableBriefFieldSchema,
  budgetHint: nullableBriefFieldSchema,
  referralSource: nullableBriefFieldSchema,
  constraints: nullableBriefFieldSchema
});

const confidenceSchema = z.object({
  fullName: z.number().min(0).max(1),
  email: z.number().min(0).max(1),
  phone: z.number().min(0).max(1),
  telegramHandle: z.number().min(0).max(1),
  serviceType: z.number().min(0).max(1),
  primaryGoal: z.number().min(0).max(1),
  firstDeliverable: z.number().min(0).max(1),
  timelineHint: z.number().min(0).max(1),
  budgetHint: z.number().min(0).max(1),
  referralSource: z.number().min(0).max(1),
  constraints: z.number().min(0).max(1)
});

const evidenceSchema = z.object({
  fullName: z.string().max(240).nullable(),
  email: z.string().max(240).nullable(),
  phone: z.string().max(240).nullable(),
  telegramHandle: z.string().max(240).nullable(),
  serviceType: z.string().max(240).nullable(),
  primaryGoal: z.string().max(240).nullable(),
  firstDeliverable: z.string().max(240).nullable(),
  timelineHint: z.string().max(240).nullable(),
  budgetHint: z.string().max(240).nullable(),
  referralSource: z.string().max(240).nullable(),
  constraints: z.string().max(240).nullable()
});

const extractionSchema = z.object({
  fields: briefFieldsSchema,
  confidence: confidenceSchema,
  evidence: evidenceSchema,
  ambiguities: z.array(z.enum(['budget_vs_area', 'timeline_unclear', 'contact_unclear', 'service_unclear'])).default([]),
  shouldAskClarification: z.boolean().default(false),
  clarificationType: z.enum(['budget', 'timeline', 'contact', 'service']).nullable().default(null)
});

type ExtractionPayload = z.infer<typeof extractionSchema>;

function cleanText(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function normalizeEmail(email?: string | null): string | null {
  const cleaned = cleanText(email);
  return cleaned ? cleaned.toLowerCase() : null;
}

function normalizePhone(phone?: string | null): string | null {
  const cleaned = cleanText(phone);
  if (!cleaned) {
    return null;
  }
  const digits = cleaned.replace(/[^\d]/g, '');
  if (digits.length < 8) {
    return null;
  }
  return `+${digits}`;
}

function normalizeTelegramHandle(input?: string | null): string | null {
  const cleaned = cleanText(input);
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith('@')) {
    return cleaned;
  }
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(cleaned) ? `@${cleaned}` : cleaned;
}

function normalizeFields(fields: BriefExtractionFields): BriefExtractionFields {
  return {
    ...fields,
    fullName: cleanText(fields.fullName),
    email: normalizeEmail(fields.email),
    phone: normalizePhone(fields.phone),
    telegramHandle: normalizeTelegramHandle(fields.telegramHandle),
    serviceType: cleanText(fields.serviceType),
    primaryGoal: cleanText(fields.primaryGoal),
    firstDeliverable: cleanText(fields.firstDeliverable),
    timelineHint: cleanText(fields.timelineHint),
    budgetHint: cleanText(fields.budgetHint),
    referralSource: cleanText(fields.referralSource),
    constraints: cleanText(fields.constraints)
  };
}

function isRecoverableOpenAiError(error: unknown): boolean {
  if (isLengthLimitParseError(error)) {
    return true;
  }
  if (error instanceof OpenAI.RateLimitError || error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.InternalServerError) {
    return true;
  }
  if (error instanceof OpenAI.APIError) {
    const code = typeof error.code === 'string' ? error.code : '';
    return error.status === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded';
  }
  return false;
}

function isLengthLimitParseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'LengthFinishReasonError') {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes('length limit was reached') || message.includes('finish_reason') || message.includes('could not parse response content');
}

function isExtractionEmpty(fields: BriefExtractionFields): boolean {
  return Object.values(fields).every((value) => !cleanText(value));
}

function isShortFollowupMessage(message: string): boolean {
  const normalized = cleanText(message) ?? '';
  if (!normalized) {
    return false;
  }
  if (normalized.includes('\n')) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return normalized.length <= 120 && words.length <= 18;
}

function toDeterministicResult(params: {
  deterministicSignals: LeadSignals;
  hasAreaContext: boolean;
}): BriefExtractionResult {
  const fields = normalizeFields({
    fullName: params.deterministicSignals.name,
    email: params.deterministicSignals.normalizedEmail ?? params.deterministicSignals.email,
    phone: params.deterministicSignals.normalizedPhone ?? params.deterministicSignals.phone,
    telegramHandle: params.deterministicSignals.telegramHandle,
    serviceType: params.deterministicSignals.serviceType,
    primaryGoal: params.deterministicSignals.primaryGoal,
    firstDeliverable: params.deterministicSignals.firstDeliverable,
    timelineHint: params.deterministicSignals.timelineHint,
    budgetHint: params.deterministicSignals.budgetHint,
    referralSource: params.deterministicSignals.referralSource,
    constraints: params.deterministicSignals.constraints
  });

  const ambiguities: BriefExtractionAmbiguity[] = [];
  let clarificationType: BriefExtractionClarificationType = null;
  let shouldAskClarification = false;
  if (params.hasAreaContext && !fields.budgetHint) {
    ambiguities.push('budget_vs_area');
    clarificationType = 'budget';
    shouldAskClarification = true;
  }

  return {
    fields,
    evidence: {},
    confidence: {},
    ambiguities,
    shouldAskClarification,
    clarificationType,
    extractorUsed: false,
    extractorModel: null,
    deterministicFallback: true,
    deterministicSignals: params.deterministicSignals,
    hasAreaContext: params.hasAreaContext
  };
}

function enforceStrictNoGuess(params: {
  payload: ExtractionPayload;
  fullContextText: string;
}): Pick<BriefExtractionResult, 'fields' | 'evidence' | 'confidence' | 'ambiguities' | 'shouldAskClarification' | 'clarificationType' | 'hasAreaContext'> {
  const hasAreaContext = hasAreaSignal(params.fullContextText);
  const hasBudgetMarkers = hasExplicitBudgetSignal(params.fullContextText);
  const fields = normalizeFields({...params.payload.fields});
  const evidence: Partial<Record<BriefFieldKey, string>> = {};
  const confidence: Partial<Record<BriefFieldKey, number>> = {};
  const ambiguities = [...params.payload.ambiguities] as BriefExtractionAmbiguity[];

  const fieldKeys = Object.keys(fields) as BriefFieldKey[];
  for (const field of fieldKeys) {
    const score = params.payload.confidence[field];
    confidence[field] = score;
    const quote = cleanText(params.payload.evidence[field] ?? null);
    if (quote) {
      evidence[field] = quote;
    }
    if (!fields[field]) {
      continue;
    }
    if (score < EXTRACT_CONFIDENCE_THRESHOLD) {
      fields[field] = null;
    }
  }

  if (hasAreaContext && !hasBudgetMarkers && fields.budgetHint) {
    fields.budgetHint = null;
    if (!ambiguities.includes('budget_vs_area')) {
      ambiguities.push('budget_vs_area');
    }
  }

  let clarificationType: BriefExtractionClarificationType = params.payload.clarificationType;
  let shouldAskClarification = params.payload.shouldAskClarification;
  if (hasAreaContext && !hasBudgetMarkers && !fields.budgetHint) {
    clarificationType = 'budget';
    shouldAskClarification = true;
    if (!ambiguities.includes('budget_vs_area')) {
      ambiguities.push('budget_vs_area');
    }
  }

  return {
    fields,
    evidence,
    confidence,
    ambiguities,
    shouldAskClarification,
    clarificationType,
    hasAreaContext
  };
}

export async function extractBriefSignals(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
  conversationId?: string;
}): Promise<BriefExtractionResult> {
  const turnStartedAt = Date.now();
  const deterministicSignals = extractLeadSignalsDeterministic({
    history: params.history,
    message: params.message
  });
  const useFastProfile = isShortFollowupMessage(params.message);
  const selectedHistoryWindow = useFastProfile ? EXTRACT_FAST_HISTORY_WINDOW : EXTRACT_HISTORY_WINDOW;
  const selectedMaxOutputTokens = useFastProfile ? EXTRACT_FAST_MAX_OUTPUT_TOKENS : EXTRACT_MAX_OUTPUT_TOKENS;
  const selectedRetryMaxOutputTokens = useFastProfile ? EXTRACT_FAST_RETRY_OUTPUT_TOKENS : EXTRACT_RETRY_OUTPUT_TOKENS;
  const contextMessages = params.history.slice(-selectedHistoryWindow);
  const fullContextText = [
    ...contextMessages.map((item) => `${item.role}: ${item.content}`),
    `user: ${params.message}`
  ].join('\n');
  const hasAreaContext = hasAreaSignal(fullContextText);
  let llmCallsCount = 0;
  let tokenCapHit = false;

  if (!client) {
    return toDeterministicResult({
      deterministicSignals,
      hasAreaContext
    });
  }

  const systemPrompt = [
    'You extract structured brief fields from a multilingual sales conversation.',
    'Use full conversation context, not only the latest message.',
    'STRICT NO-GUESS: if uncertain, return null for that field.',
    'Never map area/square meters/plot size/house area to budget.',
    'Budget can be filled only with explicit financial intent or clear currency/price markers.',
    'If numbers are about area (m2, sqm, площадь, участок), keep budgetHint=null and add budget_vs_area ambiguity.',
    'Do not hallucinate contacts, timelines, or budget.',
    'Output must strictly match the schema.'
  ].join(' ');

  const userPrompt = [
    `Locale: ${params.locale}`,
    'Conversation history (newest last):',
    contextMessages.map((item) => `${item.role}: ${item.content}`).join('\n') || '(empty)',
    '',
    'Current user message:',
    params.message
  ].join('\n');

  const buildParsedCompletion = async (maxCompletionTokens: number): Promise<{parsed: ExtractionPayload | null; tokenCapHit: boolean}> => {
    const startedAt = Date.now();
    const completion = await client.chat.completions.parse({
      model: EXTRACT_MODEL,
      messages: [
        {role: 'system', content: systemPrompt},
        {role: 'user', content: userPrompt}
      ],
      response_format: zodResponseFormat(extractionSchema, 'brief_extraction'),
      max_completion_tokens: maxCompletionTokens
    }, {
      timeout: EXTRACT_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES
    });

    const usage = completion.usage;
    const completionTokenCapHit = (usage?.completion_tokens ?? 0) >= Math.max(maxCompletionTokens - 2, 1);
    llmCallsCount += 1;
    tokenCapHit = tokenCapHit || completionTokenCapHit;
    console.info('[brief_extractor] OpenAI usage', {
      path: 'chat/message',
      conversationId: params.conversationId ?? 'unknown',
      model: EXTRACT_MODEL,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      requestId: (completion as {_request_id?: string})._request_id ?? null,
      latencyMs: Date.now() - startedAt,
      maxCompletionTokens,
      tokenCapHit: completionTokenCapHit,
      profile: useFastProfile ? 'fast' : 'full'
    });

    return {
      parsed: completion.choices[0]?.message.parsed ?? null,
      tokenCapHit: completionTokenCapHit
    };
  };

  try {
    let parseFailReason: 'length_limit' | 'invalid_json' | null = null;
    let parsedResult = await buildParsedCompletion(selectedMaxOutputTokens);
    let parsed = parsedResult.parsed;
    if (!parsed) {
      parseFailReason = 'invalid_json';
      parsedResult = await buildParsedCompletion(selectedRetryMaxOutputTokens);
      parsed = parsedResult.parsed;
    }
    if (!parsed) {
      console.info('[brief_extractor] turn summary', {
        conversationId: params.conversationId ?? 'unknown',
        model: EXTRACT_MODEL,
        deterministicFallback: true,
        llm_calls_count_per_turn: llmCallsCount,
        parse_fail_reason: parseFailReason,
        token_cap_hit: tokenCapHit,
        extract_latency_ms: Date.now() - turnStartedAt
      });
      return toDeterministicResult({
        deterministicSignals,
        hasAreaContext
      });
    }

    const normalized = enforceStrictNoGuess({
      payload: parsed,
      fullContextText
    });
    if (isExtractionEmpty(normalized.fields)) {
      console.info('[brief_extractor] turn summary', {
        conversationId: params.conversationId ?? 'unknown',
        model: EXTRACT_MODEL,
        deterministicFallback: true,
        llm_calls_count_per_turn: llmCallsCount,
        parse_fail_reason: 'invalid_json',
        token_cap_hit: tokenCapHit,
        extract_latency_ms: Date.now() - turnStartedAt
      });
      return toDeterministicResult({
        deterministicSignals,
        hasAreaContext: normalized.hasAreaContext
      });
    }

    console.info('[brief_extractor] turn summary', {
      conversationId: params.conversationId ?? 'unknown',
      model: EXTRACT_MODEL,
      deterministicFallback: false,
      llm_calls_count_per_turn: llmCallsCount,
      parse_fail_reason: null,
      token_cap_hit: tokenCapHit,
      extract_latency_ms: Date.now() - turnStartedAt
    });
    return {
      fields: normalized.fields,
      evidence: normalized.evidence,
      confidence: normalized.confidence,
      ambiguities: normalized.ambiguities,
      shouldAskClarification: normalized.shouldAskClarification,
      clarificationType: normalized.clarificationType,
      extractorUsed: true,
      extractorModel: EXTRACT_MODEL,
      deterministicFallback: false,
      deterministicSignals,
      hasAreaContext: normalized.hasAreaContext
    };
  } catch (error) {
    if (isLengthLimitParseError(error)) {
      try {
        console.warn('[brief_extractor] Length-limited parse, retrying with increased max tokens', {
          conversationId: params.conversationId ?? 'unknown',
          model: EXTRACT_MODEL,
          retryMaxCompletionTokens: selectedRetryMaxOutputTokens,
          profile: useFastProfile ? 'fast' : 'full'
        });

        const retryResult = await buildParsedCompletion(selectedRetryMaxOutputTokens);
        const parsed = retryResult.parsed;
        if (parsed) {
          const normalized = enforceStrictNoGuess({
            payload: parsed,
            fullContextText
          });
          if (!isExtractionEmpty(normalized.fields)) {
            console.info('[brief_extractor] turn summary', {
              conversationId: params.conversationId ?? 'unknown',
              model: EXTRACT_MODEL,
              deterministicFallback: false,
              llm_calls_count_per_turn: llmCallsCount,
              parse_fail_reason: null,
              token_cap_hit: tokenCapHit,
              extract_latency_ms: Date.now() - turnStartedAt
            });
            return {
              fields: normalized.fields,
              evidence: normalized.evidence,
              confidence: normalized.confidence,
              ambiguities: normalized.ambiguities,
              shouldAskClarification: normalized.shouldAskClarification,
              clarificationType: normalized.clarificationType,
              extractorUsed: true,
              extractorModel: EXTRACT_MODEL,
              deterministicFallback: false,
              deterministicSignals,
              hasAreaContext: normalized.hasAreaContext
            };
          }
        }
      } catch (retryError) {
        if (retryError instanceof OpenAI.APIError) {
          console.warn('[brief_extractor] Retry after length-limited parse failed, falling back to deterministic', {
            status: retryError.status,
            code: retryError.code,
            requestId: retryError.requestID
          });
        } else {
          console.warn('[brief_extractor] Retry after length-limited parse failed, falling back to deterministic', {
            message: retryError instanceof Error ? retryError.message : String(retryError)
          });
        }
      }
      console.info('[brief_extractor] turn summary', {
        conversationId: params.conversationId ?? 'unknown',
        model: EXTRACT_MODEL,
        deterministicFallback: true,
        llm_calls_count_per_turn: llmCallsCount,
        parse_fail_reason: 'length_limit',
        token_cap_hit: tokenCapHit,
        extract_latency_ms: Date.now() - turnStartedAt
      });
      return toDeterministicResult({
        deterministicSignals,
        hasAreaContext
      });
    }
    if (isRecoverableOpenAiError(error)) {
      if (error instanceof OpenAI.APIError) {
        console.warn('[brief_extractor] Recoverable OpenAI error, falling back to deterministic', {
          status: error.status,
          code: error.code,
          requestId: error.requestID
        });
      }
      console.info('[brief_extractor] turn summary', {
        conversationId: params.conversationId ?? 'unknown',
        model: EXTRACT_MODEL,
        deterministicFallback: true,
        llm_calls_count_per_turn: llmCallsCount,
        parse_fail_reason: null,
        token_cap_hit: tokenCapHit,
        extract_latency_ms: Date.now() - turnStartedAt
      });
      return toDeterministicResult({
        deterministicSignals,
        hasAreaContext
      });
    }
    throw error;
  }
}
