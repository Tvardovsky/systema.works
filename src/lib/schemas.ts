import {z} from 'zod';

export const startSessionSchema = z.object({
  locale: z.enum(['en', 'sr-ME', 'ru', 'uk']),
  turnstileToken: z.string().optional().default(''),
  pagePath: z.string().min(1).max(200),
  honeypot: z.string().optional().default('')
});

export const chatMessageSchema = z.object({
  sessionId: z.string().uuid(),
  locale: z.enum(['en', 'sr-ME', 'ru', 'uk']),
  message: z.string().min(2).max(2000),
  turnstileToken: z.string().optional().default(''),
  honeypot: z.string().optional().default('')
});

export const leadSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  locale: z.enum(['en', 'sr-ME', 'ru', 'uk']),
  name: z.string().min(2).max(120),
  company: z.string().max(120).optional().default(''),
  serviceInterest: z.enum(['web', 'automation', 'smm', 'combo']),
  budgetBand: z.enum(['<1k', '1k-3k', '3k-10k', '10k+', 'unknown']),
  timeline: z.enum(['asap', '1m', '3m', 'exploring']),
  contactChannel: z.enum(['telegram', 'whatsapp', 'email', 'phone']),
  contactValue: z.string().min(3).max(120),
  consent: z.boolean(),
  honeypot: z.string().optional().default('')
});

export const aiReplySchema = z.object({
  answer: z.string().min(1),
  topic: z.enum(['allowed', 'disallowed', 'unclear']),
  leadIntentScore: z.number().min(0).max(100),
  nextQuestion: z.string().min(1),
  requiresLeadCapture: z.boolean()
});
