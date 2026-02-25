import OpenAI from 'openai';
import {z} from 'zod';
import {zodResponseFormat} from 'openai/helpers/zod';
import type {Locale} from '@/types/lead';
import type {
  DialogFallbackPath,
  DialogSlotKey,
  DialogTopic,
  DialogTurnMode
} from './types';

const DIRECTOR_PRIMARY_MODEL = process.env.OPENAI_FAST_MODEL ?? 'gpt-5-mini';
const DIRECTOR_RETRY_MODEL = process.env.OPENAI_FALLBACK_MODEL ?? DIRECTOR_PRIMARY_MODEL;
const DIRECTOR_MAX_OUTPUT_TOKENS = Math.max(120, Number.parseInt(process.env.OPENAI_DIRECTOR_MAX_OUTPUT_TOKENS ?? '240', 10) || 240);
const DIRECTOR_TIMEOUT_MS = Math.max(1500, Number.parseInt(process.env.OPENAI_DIRECTOR_TIMEOUT_MS ?? '2600', 10) || 2600);
const OPENAI_MAX_RETRIES = Math.max(0, Number.parseInt(process.env.OPENAI_MAX_RETRIES ?? '0', 10) || 0);

const directorClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT_ID || undefined,
      organization: process.env.OPENAI_ORG_ID || undefined,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: DIRECTOR_TIMEOUT_MS
    })
  : null;

const DIRECTOR_SLOTS = [
  'serviceType',
  'primaryGoal',
  'firstDeliverable',
  'timeline',
  'budget',
  'contact',
  'fullName',
  'referralSource',
  'handoff',
  'scope'
] as const;

const directorReplySchema = z.object({
  answer: z.string().min(1).max(900),
  turnMode: z.enum(['progress', 'answer_only', 'scope_clarify']),
  nextSlot: z.enum(DIRECTOR_SLOTS).nullable(),
  nextQuestion: z.string().max(260)
});

function stripMarkdownCodeFence(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractLikelyJsonObject(input: string): string | null {
  const stripped = stripMarkdownCodeFence(input);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  return stripped.slice(start, end + 1);
}

function normalizeJsonLikeText(input: string): string {
  return input
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

function tryParseDirectorDraftFromText(content: string): DirectorDraft | null {
  const candidate = extractLikelyJsonObject(content);
  if (!candidate) {
    return null;
  }
  try {
    const parsedJson = JSON.parse(normalizeJsonLikeText(candidate));
    const parsed = directorReplySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return null;
    }
    return normalizeDirectorOutput(parsed.data);
  } catch {
    return null;
  }
}

function normalizeDirectorTextFromContent(raw: unknown): string {
  if (typeof raw === 'string') {
    return clean(raw);
  }
  if (!Array.isArray(raw)) {
    return '';
  }
  const chunks = raw
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (!part || typeof part !== 'object') {
        return '';
      }
      const candidate = (
        (part as {text?: unknown}).text
        ?? (part as {content?: unknown}).content
        ?? (part as {value?: unknown}).value
      );
      return typeof candidate === 'string' ? candidate : '';
    })
    .map((item) => clean(item))
    .filter(Boolean);
  return clean(chunks.join('\n'));
}

function coerceNaturalDirectorDraft(content: string): DirectorDraft | null {
  const cleaned = clean(stripMarkdownCodeFence(content));
  if (!cleaned) {
    return null;
  }
  const looksJsonish = cleaned.startsWith('{') || cleaned.startsWith('[');
  if (looksJsonish) {
    return null;
  }
  return normalizeDirectorOutput({
    answer: cleaned.length > 900 ? `${cleaned.slice(0, 899)}…` : cleaned,
    turnMode: 'progress',
    nextSlot: null,
    nextQuestion: ''
  });
}

function clean(input?: string | null): string {
  return (input ?? '').trim().replace(/\s+/g, ' ');
}

function isRecoverableError(error: unknown): boolean {
  return (
    error instanceof OpenAI.RateLimitError
    || error instanceof OpenAI.APIConnectionError
    || error instanceof OpenAI.InternalServerError
    || (error instanceof OpenAI.APIError && error.status === 429)
  );
}

function buildSystemPrompt(locale: Locale): string {
  return [
    'You are SYSTEMA.WORKS qualification director.',
    'Write naturally, context-aware, concise.',
    'Never sound like a rigid checklist.',
    'Respect locale strictly.',
    `Target locale: ${locale}.`,
    'Return JSON only.'
  ].join(' ');
}

function buildDeveloperPrompt(): string {
  return [
    'Output JSON fields only: answer, turnMode, nextSlot, nextQuestion.',
    'turnMode must be one of progress|answer_only|scope_clarify.',
    'If turnMode=answer_only, keep nextQuestion empty.',
    'Max two questions total in this turn.'
  ].join(' ');
}

function buildUserPrompt(params: {
  locale: Locale;
  topic: DialogTopic;
  message: string;
  recentHistory: Array<{role: 'user' | 'assistant'; content: string}>;
  deterministicNextSlot: DialogSlotKey | 'handoff' | 'scope';
  deterministicNextQuestion: string;
  missingBlocking: string[];
  forcedTurnMode: DialogTurnMode | null;
}): string {
  const history = params.recentHistory
    .slice(-10)
    .map((item) => `${item.role}: ${item.content}`)
    .join('\n');

  return [
    `Locale=${params.locale}.`,
    `topic=${params.topic}.`,
    `missingBlocking=${params.missingBlocking.join(',') || 'none'}.`,
    `deterministicNextSlot=${params.deterministicNextSlot}.`,
    `deterministicNextQuestion=${params.deterministicNextQuestion}.`,
    `forcedTurnMode=${params.forcedTurnMode ?? 'none'}.`,
    `Recent history:\n${history || '(empty)'}`,
    `Current user message:\n${params.message}`,
    'Answer user request first, then move dialog forward when allowed.',
    'If forcedTurnMode=answer_only, do not ask a new slot question this turn.',
    'If topic is unclear/disallowed, use scope_clarify.'
  ].join('\n\n');
}

function normalizeDirectorOutput(raw: z.infer<typeof directorReplySchema>): DirectorDraft {
  const answer = clean(raw.answer);
  const nextQuestion = clean(raw.nextQuestion ?? '');
  const nextSlot = raw.nextSlot ?? null;
  return {
    answer,
    turnMode: raw.turnMode,
    nextSlot,
    nextQuestion
  };
}

async function callDirectorModel(params: {
  model: string;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  conversationId?: string;
}): Promise<DirectorDraft | null> {
  if (!directorClient) {
    return null;
  }
  const completion = await directorClient.chat.completions.parse({
    model: params.model,
    messages: [
      {role: 'system', content: params.systemPrompt},
      {role: 'developer', content: params.developerPrompt},
      {role: 'user', content: params.userPrompt}
    ],
    response_format: zodResponseFormat(directorReplySchema, 'dialog_v3_director_reply'),
    max_completion_tokens: DIRECTOR_MAX_OUTPUT_TOKENS
  }, {
    timeout: DIRECTOR_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES
  });

  const parsed = completion.choices[0]?.message?.parsed ?? null;
  if (!parsed) {
    const rawContent = completion.choices[0]?.message?.content;
    const content = normalizeDirectorTextFromContent(rawContent);
    if (!content) {
      return null;
    }
    return tryParseDirectorDraftFromText(content) ?? coerceNaturalDirectorDraft(content);
  }

  console.info('[dialog-v3] director usage', {
    conversationId: params.conversationId ?? 'unknown',
    model: params.model,
    requestId: (completion as {_request_id?: string})._request_id ?? null,
    inputTokens: completion.usage?.prompt_tokens ?? null,
    outputTokens: completion.usage?.completion_tokens ?? null
  });
  return normalizeDirectorOutput(parsed);
}

export type DirectorDraft = {
  answer: string;
  turnMode: DialogTurnMode;
  nextSlot: DialogSlotKey | 'handoff' | 'scope' | null;
  nextQuestion: string;
};

export type DirectorRequestFn = (params: {
  attempt: 'primary' | 'retry';
  model: string;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
}) => Promise<DirectorDraft | null>;

export type DirectorResult = {
  draft: DirectorDraft | null;
  llmCallsCount: number;
  fallbackPath: DialogFallbackPath;
  sameModelFallbackSkipped: boolean;
};

export async function runDialogV3Director(params: {
  locale: Locale;
  topic: DialogTopic;
  message: string;
  recentHistory: Array<{role: 'user' | 'assistant'; content: string}>;
  deterministicNextSlot: DialogSlotKey | 'handoff' | 'scope';
  deterministicNextQuestion: string;
  missingBlocking: string[];
  forcedTurnMode: DialogTurnMode | null;
  conversationId?: string;
  primaryModel?: string;
  retryModel?: string;
  requestFn?: DirectorRequestFn;
}): Promise<DirectorResult> {
  const primaryModel = clean(params.primaryModel) || DIRECTOR_PRIMARY_MODEL;
  const retryModel = clean(params.retryModel) || DIRECTOR_RETRY_MODEL;
  const systemPrompt = buildSystemPrompt(params.locale);
  const developerPrompt = buildDeveloperPrompt();
  const userPrompt = buildUserPrompt({
    locale: params.locale,
    topic: params.topic,
    message: params.message,
    recentHistory: params.recentHistory,
    deterministicNextSlot: params.deterministicNextSlot,
    deterministicNextQuestion: params.deterministicNextQuestion,
    missingBlocking: params.missingBlocking,
    forcedTurnMode: params.forcedTurnMode
  });

  let llmCallsCount = 0;
  let sameModelFallbackSkipped = false;
  const runAttempt = async (attempt: 'primary' | 'retry', model: string): Promise<DirectorDraft | null> => {
    if (params.requestFn) {
      llmCallsCount += 1;
      try {
        return await params.requestFn({
          attempt,
          model,
          systemPrompt,
          developerPrompt,
          userPrompt
        });
      } catch (error) {
        console.warn('[dialog-v3] director requestFn failed, fallback to deterministic', {
          attempt,
          model,
          error: error instanceof Error ? error.message : String(error)
        });
        return null;
      }
    }
    if (!directorClient) {
      return null;
    }
    llmCallsCount += 1;
    try {
      return await callDirectorModel({
        model,
        systemPrompt,
        developerPrompt,
        userPrompt,
        conversationId: params.conversationId
      });
    } catch (error) {
      if (isRecoverableError(error)) {
        return null;
      }
      console.warn('[dialog-v3] director attempt failed, fallback to deterministic', {
        attempt,
        model,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  };

  const primaryDraft = await runAttempt('primary', primaryModel);
  if (primaryDraft) {
    return {
      draft: primaryDraft,
      llmCallsCount,
      fallbackPath: 'primary',
      sameModelFallbackSkipped
    };
  }

  if (retryModel.trim().toLowerCase() === primaryModel.trim().toLowerCase()) {
    sameModelFallbackSkipped = true;
    return {
      draft: null,
      llmCallsCount,
      fallbackPath: 'deterministic',
      sameModelFallbackSkipped
    };
  }

  const retryDraft = await runAttempt('retry', retryModel);
  if (retryDraft) {
    return {
      draft: retryDraft,
      llmCallsCount,
      fallbackPath: 'retry',
      sameModelFallbackSkipped
    };
  }

  return {
    draft: null,
    llmCallsCount,
    fallbackPath: 'deterministic',
    sameModelFallbackSkipped
  };
}
