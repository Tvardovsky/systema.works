'use client';

import type {ConfidenceLevel} from '@/lib/conversation/brief-types';

type Props = {
  confidence: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

/**
 * Display confidence indicator for extracted brief fields.
 */
export function BriefConfidenceIndicator({confidence, showLabel = true, size = 'sm'}: Props) {
  const level: ConfidenceLevel = getConfidenceLevel(confidence);
  
  const config = {
    high: {
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      icon: '✓',
      label: 'High confidence'
    },
    medium: {
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      icon: '⚠',
      label: 'Medium confidence'
    },
    low: {
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      icon: '✗',
      label: 'Low confidence'
    }
  };
  
  const {color, bgColor, icon, label} = config[level];
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5'
  };
  
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium ${color} ${bgColor} ${sizeClasses[size]}`}>
      <span>{icon}</span>
      {showLabel && <span>{label}</span>}
      <span className="opacity-75">({Math.round(confidence * 100)}%)</span>
    </span>
  );
}

/**
 * Get confidence level from score.
 */
function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/**
 * Display evidence quote from extraction.
 */
export function BriefEvidenceQuote({
  evidence,
  field
}: {
  evidence: string | null;
  field: string;
}) {
  if (!evidence) {
    return null;
  }
  
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
        Show evidence for {field}
      </summary>
      <blockquote className="mt-1 pl-3 border-l-2 border-gray-300 italic text-gray-600">
        "{evidence}"
      </blockquote>
    </details>
  );
}

/**
 * Display validation warnings for field.
 */
export function BriefFieldWarnings({warnings}: {warnings: string[]}) {
  if (!warnings || warnings.length === 0) {
    return null;
  }
  
  const warningMessages: Record<string, string> = {
    budget_may_be_area: '⚠ May be area (m²) instead of budget',
    budget_no_currency_marker: '⚠ No currency marker found',
    email_invalid_format: '⚠ Invalid email format',
    phone_invalid_length: '⚠ Phone number length invalid'
  };
  
  return (
    <div className="mt-1 space-y-0.5">
      {warnings.map((warning, index) => (
        <div key={index} className="text-xs text-orange-600">
          {warningMessages[warning] || `⚠ ${warning}`}
        </div>
      ))}
    </div>
  );
}

/**
 * Display manager verification status.
 */
export function BriefVerificationStatus({
  verified,
  onVerify
}: {
  verified: boolean;
  onVerify?: () => void;
}) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
        <span>✓</span>
        <span>Verified by manager</span>
      </span>
    );
  }
  
  if (onVerify) {
    return (
      <button
        type="button"
        onClick={onVerify}
        className="text-xs text-blue-600 hover:text-blue-800 underline"
      >
        Mark as verified
      </button>
    );
  }
  
  return (
    <span className="text-xs text-gray-400">
      Not verified
    </span>
  );
}
