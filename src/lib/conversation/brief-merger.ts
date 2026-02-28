import type {MergedBrief, ExtractedField, ExtractionSource} from './brief-types';

/**
 * Mark a field as manager verified (won't be overwritten).
 */
export function markFieldAsVerified(
  brief: MergedBrief,
  fieldKey: string
): MergedBrief {
  if (brief.managerVerifiedFields.includes(fieldKey)) {
    return brief; // Already verified
  }
  
  return {
    ...brief,
    managerVerifiedFields: [...brief.managerVerifiedFields, fieldKey],
    fieldSource: {
      ...brief.fieldSource,
      [fieldKey]: 'manager' as ExtractionSource
    }
  };
}

/**
 * Update a specific field in the brief.
 */
export function updateBriefField<T extends keyof MergedBrief>(
  brief: MergedBrief,
  fieldKey: T,
  value: MergedBrief[T],
  source: ExtractionSource = 'manager'
): MergedBrief {
  const confidence = source === 'manager' ? 1.0 : 0.9;
  
  return {
    ...brief,
    [fieldKey]: value,
    fieldConfidence: {
      ...brief.fieldConfidence,
      [fieldKey]: confidence
    },
    fieldSource: {
      ...brief.fieldSource,
      [fieldKey]: source
    },
    managerVerifiedFields: source === 'manager'
      ? [...brief.managerVerifiedFields, fieldKey as string]
      : brief.managerVerifiedFields
  };
}

/**
 * Get fields that need attention (low confidence or missing).
 */
export function getFieldsNeedingAttention(brief: MergedBrief): {
  missing: string[];
  lowConfidence: string[];
  ambiguous: string[];
} {
  const allFields = [
    'fullName', 'email', 'phone', 'telegramHandle',
    'serviceType', 'primaryGoal', 'firstDeliverable',
    'timelineHint', 'budgetHint', 'referralSource', 'constraints'
  ];
  
  const missing = allFields.filter(field => brief[field as keyof MergedBrief] === null);
  const lowConfidence = allFields.filter(
    field => (brief.fieldConfidence[field] ?? 0) < 0.6 && brief[field as keyof MergedBrief] !== null
  );
  
  // Check for common ambiguities
  const ambiguous: string[] = [];
  if (brief.budgetHint && /м²|square|площадь/i.test(brief.budgetHint)) {
    ambiguous.push('budgetHint');
  }
  
  return {missing, lowConfidence, ambiguous};
}

/**
 * Calculate brief quality score (0-100).
 */
export function calculateBriefQuality(brief: MergedBrief): {
  overallScore: number;
  breakdown: {
    completenessScore: number;
    confidenceScore: number;
    verificationScore: number;
  };
  recommendation: string;
} {
  const allFields = [
    'fullName', 'email', 'phone', 'telegramHandle',
    'serviceType', 'primaryGoal', 'firstDeliverable',
    'timelineHint', 'budgetHint', 'referralSource', 'constraints'
  ];
  
  const requiredFields = ['serviceType', 'primaryGoal', 'fullName', 'email'];
  
  // Completeness: % of fields filled
  const filledCount = allFields.filter(f => brief[f as keyof MergedBrief] !== null).length;
  const completenessScore = Math.round((filledCount / allFields.length) * 100);
  
  // Confidence: average confidence of filled fields
  const filledFields = allFields.filter(f => brief[f as keyof MergedBrief] !== null);
  const avgConfidence = filledFields.length > 0
    ? filledFields.reduce((sum, f) => sum + (brief.fieldConfidence[f] ?? 0), 0) / filledFields.length
    : 0;
  const confidenceScore = Math.round(avgConfidence * 100);
  
  // Verification: % of fields manager verified
  const verificationScore = Math.round((brief.managerVerifiedFields.length / allFields.length) * 100);
  
  // Overall: weighted average
  const overallScore = Math.round(
    completenessScore * 0.5 +
    confidenceScore * 0.35 +
    verificationScore * 0.15
  );
  
  // Recommendation
  let recommendation = 'continue_data_collection';
  if (overallScore >= 80 && requiredFields.every(f => brief[f as keyof MergedBrief] !== null)) {
    recommendation = 'ready_for_handoff';
  } else if (completenessScore < 50) {
    recommendation = 'collect_more_information';
  } else if (confidenceScore < 60) {
    recommendation = 'verify_low_confidence_fields';
  } else if (requiredFields.some(f => brief[f as keyof MergedBrief] === null)) {
    recommendation = 'complete_required_fields';
  }
  
  return {
    overallScore,
    breakdown: {
      completenessScore,
      confidenceScore,
      verificationScore
    },
    recommendation
  };
}

/**
 * Export brief to manager-friendly format.
 */
export function exportBriefForManager(brief: MergedBrief): Record<string, unknown> {
  const quality = calculateBriefQuality(brief);
  const attention = getFieldsNeedingAttention(brief);
  
  return {
    // Basic fields
    fullName: brief.fullName,
    email: brief.email,
    phone: brief.phone,
    telegramHandle: brief.telegramHandle,
    serviceType: brief.serviceType,
    primaryGoal: brief.primaryGoal,
    firstDeliverable: brief.firstDeliverable,
    timelineHint: brief.timelineHint,
    budgetHint: brief.budgetHint,
    referralSource: brief.referralSource,
    constraints: brief.constraints,
    
    // Quality metrics
    qualityScore: quality.overallScore,
    completenessScore: quality.breakdown.completenessScore,
    confidenceScores: brief.fieldConfidence,
    
    // Attention flags
    missingFields: attention.missing,
    lowConfidenceFields: attention.lowConfidence,
    ambiguousFields: attention.ambiguous,
    
    // Verification status
    verifiedFields: brief.managerVerifiedFields,
    
    // Metadata
    lastUpdated: brief.lastExtractionAt,
    totalExtractions: brief.totalExtractions,
    readyForHandoff: quality.recommendation === 'ready_for_handoff'
  };
}

/**
 * Create empty merged brief structure.
 */
export function createEmptyMergedBrief(): MergedBrief {
  return {
    fullName: null,
    email: null,
    phone: null,
    telegramHandle: null,
    serviceType: null,
    primaryGoal: null,
    firstDeliverable: null,
    timelineHint: null,
    budgetHint: null,
    referralSource: null,
    constraints: null,
    fieldConfidence: {},
    fieldSource: {},
    managerVerifiedFields: [],
    lastExtractionTurn: 0,
    lastExtractionAt: new Date().toISOString(),
    totalExtractions: 0
  };
}
