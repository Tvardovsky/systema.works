export type Locale = 'en' | 'sr-ME' | 'ru' | 'uk';

export type ServiceInterest = 'web' | 'automation' | 'smm' | 'combo';

export type LeadPriority = 'low' | 'medium' | 'high';

export type ChatTopic = 'allowed' | 'disallowed' | 'unclear';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type LeadPayload = {
  locale: Locale;
  name: string;
  company?: string;
  serviceInterest: ServiceInterest;
  budgetBand: '<1k' | '1k-3k' | '3k-10k' | '10k+' | 'unknown';
  timeline: 'asap' | '1m' | '3m' | 'exploring';
  contactChannel: 'telegram' | 'whatsapp' | 'email' | 'phone';
  contactValue: string;
  consent: boolean;
  chatTranscriptId: string;
};

export type ChatResponse = {
  answer: string;
  topic: ChatTopic;
  leadIntentScore: number;
  nextQuestion: string;
  requiresLeadCapture: boolean;
};
