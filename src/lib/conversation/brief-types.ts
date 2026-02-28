import type {Locale} from '@/types/lead';

/**
 * Brief field extraction confidence levels.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Source of brief field extraction.
 */
export type ExtractionSource = 'llm' | 'regex' | 'manager' | 'inferred';

/**
 * Extracted brief field with confidence and evidence.
 */
export interface ExtractedField<T = string> {
  /** Extracted value (null if not found) */
  value: T | null;
  /** Confidence score 0.0-1.0 */
  confidence: number;
  /** Confidence level label */
  confidenceLevel: ConfidenceLevel;
  /** Source of extraction */
  source: ExtractionSource;
  /** Evidence quote from conversation */
  evidence: string | null;
  /** When this field was extracted */
  extractedAt: string;
  /** Which turn in conversation */
  extractionTurn: number;
  /** Whether manager has verified this field */
  managerVerified: boolean;
  /** Validation warnings if any */
  warnings: string[];
}

/**
 * Complete extracted brief from conversation.
 */
export interface ExtractedBrief {
  // Identity fields (relationship thread)
  fullName: ExtractedField<string>;
  email: ExtractedField<string>;
  phone: ExtractedField<string>;
  telegramHandle: ExtractedField<string>;
  
  // Project scope (project_scope thread)
  serviceType: ExtractedField<string>;
  primaryGoal: ExtractedField<string>;
  firstDeliverable: ExtractedField<string>;
  
  // Logistics (logistics thread)
  timelineHint: ExtractedField<string>;
  budgetHint: ExtractedField<string>;
  
  // Additional context
  referralSource: ExtractedField<string>;
  constraints: ExtractedField<string>;
  
  // Metadata
  extractionTurn: number;
  extractionTimestamp: string;
  conversationId: string;
  locale: Locale;
  modelVersion: string;
}

/**
 * Merged brief result after combining extractions.
 */
export interface MergedBrief {
  // Final values (after merging)
  fullName: string | null;
  email: string | null;
  phone: string | null;
  telegramHandle: string | null;
  serviceType: string | null;
  primaryGoal: string | null;
  firstDeliverable: string | null;
  timelineHint: string | null;
  budgetHint: string | null;
  referralSource: string | null;
  constraints: string | null;
  
  // Confidence scores for each field
  fieldConfidence: Record<string, number>;
  
  // Source of each field
  fieldSource: Record<string, ExtractionSource>;
  
  // Manager verified fields
  managerVerifiedFields: string[];
  
  // Metadata
  lastExtractionTurn: number;
  lastExtractionAt: string;
  totalExtractions: number;
}

/**
 * Brief completeness calculation.
 */
export interface BriefCompleteness {
  /** Overall score 0-100 */
  score: number;
  /** Missing required fields */
  missingFields: string[];
  /** Fields with low confidence */
  lowConfidenceFields: string[];
  /** Ready for human handoff */
  readyForHandoff: boolean;
  /** Recommended next action */
  recommendedAction: string;
}

/**
 * LLM extraction output schema.
 */
export interface LLMExtractionOutput {
  fullName?: LLMFieldOutput | null;
  email?: LLMFieldOutput | null;
  phone?: LLMFieldOutput | null;
  telegramHandle?: LLMFieldOutput | null;
  serviceType?: LLMFieldOutput | null;
  primaryGoal?: LLMFieldOutput | null;
  firstDeliverable?: LLMFieldOutput | null;
  timelineHint?: LLMFieldOutput | null;
  budgetHint?: LLMFieldOutput | null;
  referralSource?: LLMFieldOutput | null;
  constraints?: LLMFieldOutput | null;
  ambiguities?: LLMAmbiguity[];
}

/**
 * Single field output from LLM.
 */
export interface LLMFieldOutput {
  value: string | null;
  confidence: number;
  evidence: string | null;
  warnings?: string[];
}

/**
 * Ambiguity detected during extraction.
 */
export interface LLMAmbiguity {
  field: string;
  issue: string;
  possibleValues: string[];
  recommendation: string;
}

/**
 * Input for brief extraction.
 */
export interface BriefExtractionInput {
  locale: Locale;
  message: string;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
  conversationId: string;
  currentTurn: number;
  existingBrief?: MergedBrief | null;
}

/**
 * Extraction result with diagnostics.
 */
export interface BriefExtractionResult {
  extractedBrief: ExtractedBrief;
  mergedBrief: MergedBrief;
  completeness: BriefCompleteness;
  ambiguities: LLMAmbiguity[];
  llmCallsCount: number;
  extractionLatencyMs: number;
  modelUsed: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Brief extraction history entry.
 */
export interface BriefExtractionHistory {
  id: string;
  conversationId: string;
  extractionTurn: number;
  extractedAt: string;
  fieldsUpdated: string[];
  modelVersion: string;
  latencyMs: number;
  fields: Record<string, ExtractedField>;
}

/**
 * Helper: Convert confidence score to level.
 */
export function confidenceToLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/**
 * Helper: Create empty extracted field.
 */
export function createEmptyField<T = string>(turn: number, timestamp: string): ExtractedField<T> {
  return {
    value: null,
    confidence: 0,
    confidenceLevel: 'low',
    source: 'llm',
    evidence: null,
    extractedAt: timestamp,
    extractionTurn: turn,
    managerVerified: false,
    warnings: []
  };
}

/**
 * Helper: Create empty brief structure.
 */
export function createEmptyExtractedBrief(
  conversationId: string,
  locale: Locale,
  turn: number
): ExtractedBrief {
  const timestamp = new Date().toISOString();
  
  return {
    fullName: createEmptyField(turn, timestamp),
    email: createEmptyField(turn, timestamp),
    phone: createEmptyField(turn, timestamp),
    telegramHandle: createEmptyField(turn, timestamp),
    serviceType: createEmptyField(turn, timestamp),
    primaryGoal: createEmptyField(turn, timestamp),
    firstDeliverable: createEmptyField(turn, timestamp),
    timelineHint: createEmptyField(turn, timestamp),
    budgetHint: createEmptyField(turn, timestamp),
    referralSource: createEmptyField(turn, timestamp),
    constraints: createEmptyField(turn, timestamp),
    extractionTurn: turn,
    extractionTimestamp: timestamp,
    conversationId,
    locale,
    modelVersion: 'conversational-v1'
  };
}

/**
 * Helper: Calculate brief completeness.
 */
export function calculateBriefCompleteness(brief: MergedBrief): BriefCompleteness {
  const requiredFields = [
    'serviceType',
    'primaryGoal',
    'timelineHint',
    'budgetHint',
    'fullName',
    'email'
  ];
  
  const optionalFields = [
    'firstDeliverable',
    'telegramHandle',
    'phone',
    'referralSource',
    'constraints'
  ];
  
  const allFields = [...requiredFields, ...optionalFields];
  const filledFields = allFields.filter(field => brief[field as keyof MergedBrief] !== null);
  const missingFields = requiredFields.filter(field => brief[field as keyof MergedBrief] === null);
  const lowConfidenceFields = allFields.filter(
    field => (brief.fieldConfidence[field] ?? 0) < 0.6
  );
  
  // Calculate score (required fields worth more)
  const requiredFilled = requiredFields.filter(f => brief[f as keyof MergedBrief] !== null).length;
  const optionalFilled = optionalFields.filter(f => brief[f as keyof MergedBrief] !== null).length;
  const score = Math.round(
    (requiredFilled / requiredFields.length) * 70 +
    (optionalFilled / optionalFields.length) * 30
  );
  
  // Determine readiness
  const readyForHandoff = 
    requiredFilled >= 4 && 
    !missingFields.includes('fullName') &&
    !missingFields.includes('serviceType') &&
    !missingFields.includes('primaryGoal');
  
  // Recommend action
  let recommendedAction = 'continue_conversation';
  if (readyForHandoff) {
    recommendedAction = 'ready_for_handoff';
  } else if (missingFields.includes('serviceType') || missingFields.includes('primaryGoal')) {
    recommendedAction = 'clarify_project_scope';
  } else if (missingFields.includes('fullName') || missingFields.includes('email')) {
    recommendedAction = 'collect_contact_info';
  } else if (missingFields.includes('timelineHint') || missingFields.includes('budgetHint')) {
    recommendedAction = 'clarify_logistics';
  }
  
  return {
    score,
    missingFields,
    lowConfidenceFields,
    readyForHandoff,
    recommendedAction
  };
}

/**
 * Helper: Validate extracted field.
 */
export function validateExtractedField(
  field: string,
  value: string | null
): {valid: boolean; warnings: string[]} {
  const warnings: string[] = [];
  
  if (!value) {
    return {valid: true, warnings: []};
  }
  
  // Budget validation
  if (field === 'budgetHint') {
    // Check for area confusion
    if (/м²|square|площадь|участок|area/i.test(value)) {
      warnings.push('budget_may_be_area');
    }
    // Check for currency markers
    if (!/(\$|€|£|USD|EUR|budget|бюджет)/i.test(value)) {
      warnings.push('budget_no_currency_marker');
    }
  }
  
  // Email validation
  if (field === 'email') {
    const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
    if (!emailRegex.test(value)) {
      warnings.push('email_invalid_format');
    }
  }
  
  // Phone validation
  if (field === 'phone') {
    const digits = value.replace(/[^\d]/g, '');
    if (digits.length < 8 || digits.length > 15) {
      warnings.push('phone_invalid_length');
    }
  }
  
  // Timeline validation
  if (field === 'timelineHint') {
    if (/soon|asap|срочно|терміново/i.test(value)) {
      // Normalize ASAP expressions
    }
  }
  
  return {valid: warnings.length === 0, warnings};
}
