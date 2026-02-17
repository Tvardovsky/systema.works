import type {LeadPriority} from '@/types/lead';

export function resolveLeadPriority(score: number): LeadPriority {
  if (score >= 70) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  return 'low';
}
