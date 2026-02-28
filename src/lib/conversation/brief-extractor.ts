import OpenAI from 'openai';
import {z} from 'zod';
import {zodResponseFormat} from 'openai/helpers/zod';
import type {Locale} from '@/types/lead';
import type {
  ExtractedBrief,
  ExtractedField,
  MergedBrief,
  BriefExtractionInput,
  BriefExtractionResult,
  LLMExtractionOutput,
  LLMFieldOutput,
  LLMAmbiguity,
  BriefCompleteness
} from './brief-types';
import {
  confidenceToLevel,
  createEmptyExtractedBrief,
  calculateBriefCompleteness,
  validateExtractedField,
  createEmptyField
} from './brief-types';

/**
 * LLM configuration for brief extraction.
 */
const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? 'gpt-4o-mini';
const EXTRACT_FALLBACK_MODEL = process.env.OPENAI_EXTRACT_FALLBACK_MODEL ?? 'gpt-3.5-turbo';
const EXTRACT_MAX_TOKENS = Math.max(500, Math.min(2000, Number.parseInt(process.env.OPENAI_EXTRACT_MAX_TOKENS ?? '1000', 10) || 1000));
const EXTRACT_TIMEOUT_MS = Math.max(5000, Math.min(30000, Number.parseInt(process.env.OPENAI_EXTRACT_TIMEOUT_MS ?? '10000', 10) || 10000));
const OPENAI_MAX_RETRIES = Math.max(0, Number.parseInt(process.env.OPENAI_MAX_RETRIES ?? '1', 10) || 1);
const MIN_TURN_FOR_EXTRACTION = 2; // Start extraction from turn 2

/**
 * OpenAI client for brief extraction.
 */
const extractClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT_ID || undefined,
      organization: process.env.OPENAI_ORG_ID || undefined,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: EXTRACT_TIMEOUT_MS
    })
  : null;

/**
 * LLM output schema for brief extraction.
 */
const llmExtractionSchema = z.object({
  fullName: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  email: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  phone: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  telegramHandle: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  serviceType: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  primaryGoal: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  firstDeliverable: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  timelineHint: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  budgetHint: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  referralSource: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  constraints: z.object({
    value: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().nullable(),
    warnings: z.array(z.string()).optional()
  }).nullable().optional(),
  ambiguities: z.array(z.object({
    field: z.string(),
    issue: z.string(),
    possibleValues: z.array(z.string()),
    recommendation: z.string()
  })).optional()
});

/**
 * Build system prompt for brief extraction.
 */
function buildSystemPrompt(locale: Locale): string {
  const localeName = locale === 'ru' ? 'Russian' : locale === 'uk' ? 'Ukrainian' : locale === 'sr-ME' ? 'Montenegrin' : 'English';
  
  return [
    `You extract structured brief fields from a ${localeName} language sales conversation for a digital agency.`,
    ``,
    `EXTRACTION RULES:`,
    `1. Use full conversation context, not just latest message`,
    `2. STRICT NO-GUESS: if uncertain, return null for that field`,
    `3. Never confuse area (m², square meters, площадь) with budget`,
    `4. Budget only with explicit financial intent or currency markers`,
    `5. If numbers are about area, keep budgetHint=null`,
    `6. Do not hallucinate contacts, timelines, or budget`,
    `7. Track confidence: 1.0=explicit, 0.7=implied, 0.4=uncertain`,
    `8. Include evidence quotes from conversation`,
    ``,
    `FIELD DEFINITIONS:`,
    `- fullName: User's name (from "меня зовут", "my name is", etc.)`,
    `- email: Email address (must contain @)`,
    `- phone: Phone number (8-15 digits)`,
    `- telegramHandle: Telegram username (with or without @)`,
    `- serviceType: Type of service (landing, web app, mobile app, automation, AI assistant, UI/UX, SMM, branding)`,
    `- primaryGoal: Main business goal (leads, sales, bookings, brand awareness)`,
    `- firstDeliverable: First concrete deliverable (homepage, catalog, booking form)`,
    `- timelineHint: When they want to launch (ASAP, 2 weeks, Q1 2025)`,
    `- budgetHint: Budget range (ONLY if explicit financial intent)`,
    `- referralSource: How they found us (Google, referral, social media)`,
    `- constraints: Limitations or requirements (must use WordPress, budget cap)`,
    ``,
    `CONFIDENCE GUIDELINES:`,
    `- 0.9-1.0: Explicit statement with clear evidence`,
    `- 0.6-0.8: Implied from context, reasonably certain`,
    `- 0.3-0.5: Uncertain, weak evidence`,
    `- 0.0-0.2: Very uncertain, likely null`,
    ``,
    `OUTPUT: Return JSON only matching the schema exactly.`
  ].join('\n');
}

/**
 * Build user prompt with conversation context.
 */
function buildUserPrompt(params: BriefExtractionInput): string {
  const {locale, message, history, currentTurn} = params;
  
  // Get recent history (last 10 turns for context)
  const recentHistory = history.slice(-10);
  const historyText = recentHistory.length > 0
    ? recentHistory.map((item) => `${item.role}: ${item.content}`).join('\n')
    : '(no previous messages)';
  
  // Add existing brief context if available
  const existingBriefText = params.existingBrief
    ? [
        'EXISTING BRIEF (for reference, extract NEW information):',
        `  Service: ${params.existingBrief.serviceType ?? 'unknown'}`,
        `  Goal: ${params.existingBrief.primaryGoal ?? 'unknown'}`,
        `  Timeline: ${params.existingBrief.timelineHint ?? 'unknown'}`,
        `  Budget: ${params.existingBrief.budgetHint ?? 'unknown'}`,
        `  Contact: ${params.existingBrief.fullName ?? 'unknown'} ${params.existingBrief.email ?? params.existingBrief.phone ?? ''}`.trim(),
        ''
      ].join('\n')
    : '';
  
  return [
    `Locale: ${locale}`,
    `Conversation turn: ${currentTurn}`,
    ``,
    existingBriefText,
    `CONVERSATION HISTORY:`,
    historyText,
    ``,
    `CURRENT USER MESSAGE:`,
    message,
    ``,
    `Extract brief fields from this conversation. Return JSON only.`
  ].filter(Boolean).join('\n\n');
}

/**
 * Call LLM to extract brief.
 */
async function callExtractionLLM(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  conversationId: string;
}): Promise<LLMExtractionOutput | null> {
  if (!extractClient) {
    return null;
  }
  
  try {
    const startedAt = Date.now();
    const completion = await extractClient.chat.completions.parse({
      model: params.model,
      messages: [
        {role: 'system', content: params.systemPrompt},
        {role: 'user', content: params.userPrompt}
      ],
      response_format: zodResponseFormat(llmExtractionSchema, 'brief_extraction'),
      max_completion_tokens: EXTRACT_MAX_TOKENS
    }, {
      timeout: EXTRACT_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES
    });
    
    const usage = completion.usage;
    console.info('[brief-extractor] LLM extraction completed', {
      conversationId: params.conversationId,
      model: params.model,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      latencyMs: Date.now() - startedAt
    });
    
    const parsed = completion.choices[0]?.message?.parsed;
    
    if (parsed) {
      return parsed as unknown as LLMExtractionOutput;
    }
    
    return null;
  } catch (error) {
    console.warn('[brief-extractor] LLM call failed', {
      model: params.model,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Convert LLM field output to ExtractedField.
 */
function llmFieldToExtractedField(
  llmField: LLMFieldOutput | null | undefined,
  turn: number,
  timestamp: string,
  existingField?: ExtractedField
): ExtractedField {
  // If no LLM output, return empty or existing
  if (!llmField || llmField.value === null) {
    if (existingField && existingField.value !== null) {
      return existingField; // Keep existing value
    }
    return createEmptyField(turn, timestamp);
  }
  
  // Validate the extracted value
  const validation = validateExtractedField('', llmField.value);
  
  // Merge with existing if we have one
  if (existingField && existingField.value !== null) {
    // Keep existing if it has higher confidence or is manager verified
    if (existingField.managerVerified || existingField.confidence > llmField.confidence) {
      return existingField;
    }
  }
  
  return {
    value: llmField.value,
    confidence: llmField.confidence,
    confidenceLevel: confidenceToLevel(llmField.confidence),
    source: 'llm',
    evidence: llmField.evidence,
    extractedAt: timestamp,
    extractionTurn: turn,
    managerVerified: false,
    warnings: [...(llmField.warnings ?? []), ...validation.warnings]
  };
}

/**
 * Merge new extraction with existing brief.
 */
function mergeExtractionWithBrief(
  existing: MergedBrief | null,
  extracted: ExtractedBrief
): MergedBrief {
  const timestamp = new Date().toISOString();
  
  // Helper to merge individual fields
  const mergeField = (
    fieldKey: keyof ExtractedBrief,
    extractedField: ExtractedField
  ): string | null => {
    if (!existing) {
      return extractedField.value;
    }
    
    const existingValue = existing[fieldKey as keyof MergedBrief] as string | null;
    const existingConfidence = existing.fieldConfidence[fieldKey as string] ?? 0;
    const existingSource = existing.fieldSource[fieldKey as string] ?? 'llm';
    
    // Manager verified fields are never overwritten
    if (existing.managerVerifiedFields.includes(fieldKey as string)) {
      return existingValue;
    }
    
    // LLM source with higher confidence wins
    if (extractedField.source === 'llm' && existingSource !== 'manager') {
      if (extractedField.confidence > existingConfidence) {
        return extractedField.value;
      }
    }
    
    // Keep existing if no new value
    if (!extractedField.value) {
      return existingValue;
    }
    
    return extractedField.value;
  };
  
  // Build merged brief
  const merged: MergedBrief = {
    fullName: mergeField('fullName', extracted.fullName),
    email: mergeField('email', extracted.email),
    phone: mergeField('phone', extracted.phone),
    telegramHandle: mergeField('telegramHandle', extracted.telegramHandle),
    serviceType: mergeField('serviceType', extracted.serviceType),
    primaryGoal: mergeField('primaryGoal', extracted.primaryGoal),
    firstDeliverable: mergeField('firstDeliverable', extracted.firstDeliverable),
    timelineHint: mergeField('timelineHint', extracted.timelineHint),
    budgetHint: mergeField('budgetHint', extracted.budgetHint),
    referralSource: mergeField('referralSource', extracted.referralSource),
    constraints: mergeField('constraints', extracted.constraints),
    
    fieldConfidence: {
      ...existing?.fieldConfidence,
      fullName: extracted.fullName.confidence,
      email: extracted.email.confidence,
      phone: extracted.phone.confidence,
      telegramHandle: extracted.telegramHandle.confidence,
      serviceType: extracted.serviceType.confidence,
      primaryGoal: extracted.primaryGoal.confidence,
      firstDeliverable: extracted.firstDeliverable.confidence,
      timelineHint: extracted.timelineHint.confidence,
      budgetHint: extracted.budgetHint.confidence,
      referralSource: extracted.referralSource.confidence,
      constraints: extracted.constraints.confidence
    },
    
    fieldSource: {
      ...existing?.fieldSource,
      fullName: extracted.fullName.source,
      email: extracted.email.source,
      phone: extracted.phone.source,
      telegramHandle: extracted.telegramHandle.source,
      serviceType: extracted.serviceType.source,
      primaryGoal: extracted.primaryGoal.source,
      firstDeliverable: extracted.firstDeliverable.source,
      timelineHint: extracted.timelineHint.source,
      budgetHint: extracted.budgetHint.source,
      referralSource: extracted.referralSource.source,
      constraints: extracted.constraints.source
    },
    
    managerVerifiedFields: existing?.managerVerifiedFields ?? [],
    lastExtractionTurn: extracted.extractionTurn,
    lastExtractionAt: timestamp,
    totalExtractions: (existing?.totalExtractions ?? 0) + 1
  };
  
  return merged;
}

/**
 * Extract brief from conversation using LLM.
 */
export async function extractBriefFromConversation(
  params: BriefExtractionInput
): Promise<BriefExtractionResult> {
  const turnStartedAt = Date.now();
  const timestamp = new Date().toISOString();
  
  // Create empty brief structure
  let extractedBrief = createEmptyExtractedBrief(
    params.conversationId,
    params.locale,
    params.currentTurn
  );
  
  let llmCallsCount = 0;
  let tokenUsage: {inputTokens: number; outputTokens: number; totalTokens: number} | undefined;
  let modelUsed = 'none';
  let ambiguities: LLMAmbiguity[] = [];
  
  // Try LLM extraction if client available
  if (extractClient) {
    const systemPrompt = buildSystemPrompt(params.locale);
    const userPrompt = buildUserPrompt(params);
    
    // Try primary model
    let llmOutput = await callExtractionLLM({
      model: EXTRACT_MODEL,
      systemPrompt,
      userPrompt,
      conversationId: params.conversationId
    });
    
    llmCallsCount += 1;
    modelUsed = EXTRACT_MODEL;
    
    // Try fallback if primary failed
    if (!llmOutput && EXTRACT_FALLBACK_MODEL !== EXTRACT_MODEL) {
      llmOutput = await callExtractionLLM({
        model: EXTRACT_FALLBACK_MODEL,
        systemPrompt,
        userPrompt,
        conversationId: params.conversationId
      });
      
      llmCallsCount += 1;
      modelUsed = EXTRACT_FALLBACK_MODEL;
    }
    
    // Process LLM output
    if (llmOutput) {
      extractedBrief.fullName = llmFieldToExtractedField(
        llmOutput.fullName, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.email = llmFieldToExtractedField(
        llmOutput.email, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.phone = llmFieldToExtractedField(
        llmOutput.phone, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.telegramHandle = llmFieldToExtractedField(
        llmOutput.telegramHandle, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.serviceType = llmFieldToExtractedField(
        llmOutput.serviceType, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.primaryGoal = llmFieldToExtractedField(
        llmOutput.primaryGoal, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.firstDeliverable = llmFieldToExtractedField(
        llmOutput.firstDeliverable, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.timelineHint = llmFieldToExtractedField(
        llmOutput.timelineHint, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.budgetHint = llmFieldToExtractedField(
        llmOutput.budgetHint, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.referralSource = llmFieldToExtractedField(
        llmOutput.referralSource, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      extractedBrief.constraints = llmFieldToExtractedField(
        llmOutput.constraints, params.currentTurn, timestamp,
        params.existingBrief ? createEmptyField(params.currentTurn, timestamp) : undefined
      );
      ambiguities = llmOutput.ambiguities ?? [];
    }
  }
  
  // Merge with existing brief
  const mergedBrief = mergeExtractionWithBrief(params.existingBrief ?? null, extractedBrief);
  
  // Calculate completeness
  const completeness: BriefCompleteness = calculateBriefCompleteness(mergedBrief);
  
  const extractionLatencyMs = Date.now() - turnStartedAt;
  
  return {
    extractedBrief,
    mergedBrief,
    completeness,
    ambiguities,
    llmCallsCount,
    extractionLatencyMs,
    modelUsed,
    tokenUsage
  };
}

/**
 * Check if brief extraction should run this turn.
 */
export function shouldExtractBrief(params: {
  currentTurn: number;
  lastExtractionTurn?: number;
  extractionInterval?: number;
  leadScoreIncreased?: boolean;
  previousLeadScore?: number;
  currentLeadScore?: number;
}): boolean {
  const {
    currentTurn,
    lastExtractionTurn = 0,
    extractionInterval = 2,
    leadScoreIncreased = false,
    previousLeadScore = 0,
    currentLeadScore = 0
  } = params;
  
  // Don't extract before minimum turn
  if (currentTurn < MIN_TURN_FOR_EXTRACTION) {
    return false;
  }
  
  // Always extract on turn 2 (first extraction)
  if (currentTurn === MIN_TURN_FOR_EXTRACTION) {
    return true;
  }
  
  // Extract if lead score increased significantly (10+ points)
  if (leadScoreIncreased && currentLeadScore - previousLeadScore >= 10) {
    return true;
  }
  
  // Extract every N turns after last extraction
  const turnsSinceLastExtraction = currentTurn - lastExtractionTurn;
  if (turnsSinceLastExtraction >= extractionInterval) {
    return true;
  }
  
  return false;
}

/**
 * Get extraction model configuration.
 */
export function getExtractionConfig(): {
  primaryModel: string;
  fallbackModel: string;
  maxTokens: number;
  timeoutMs: number;
} {
  return {
    primaryModel: EXTRACT_MODEL,
    fallbackModel: EXTRACT_FALLBACK_MODEL,
    maxTokens: EXTRACT_MAX_TOKENS,
    timeoutMs: EXTRACT_TIMEOUT_MS
  };
}

/**
 * Check if extraction client is available.
 */
export function isExtractionAvailable(): boolean {
  return extractClient !== null;
}
