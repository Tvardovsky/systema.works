import {z} from 'zod';

export const startSessionSchema = z.object({
  locale: z.enum(['en', 'sr-ME', 'ru', 'uk']),
  turnstileToken: z.string().optional().default(''),
  pagePath: z.string().min(1).max(200),
  existingSessionId: z.string().uuid().optional(),
  browserSessionKey: z.string().uuid().optional(),
  clientHints: z.object({
    language: z.string().trim().max(32).optional(),
    timezone: z.string().trim().max(100).optional(),
    platform: z.string().trim().max(64).optional(),
    viewportWidth: z.number().int().min(1).max(12000).optional(),
    viewportHeight: z.number().int().min(1).max(12000).optional(),
    dpr: z.number().min(0.1).max(10).optional(),
    touchPoints: z.number().int().min(0).max(20).optional()
  }).optional(),
  honeypot: z.string().optional().default('')
});

export const chatMessageSchema = z.object({
  sessionId: z.string().uuid(),
  locale: z.enum(['en', 'sr-ME', 'ru', 'uk']),
  message: z.string().min(2).max(2000),
  turnstileToken: z.string().optional().default(''),
  honeypot: z.string().optional().default('')
});

export const aiReplySchema = z.object({
  answer: z.string().min(1),
  topic: z.enum(['allowed', 'disallowed', 'unclear']),
  leadIntentScore: z.number().min(0).max(100),
  nextQuestion: z.string().min(1),
  requiresLeadCapture: z.boolean(),
  conversationStage: z.enum(['discovery', 'briefing', 'contact_capture', 'handoff_ready']).optional(),
  missingFields: z.array(z.string()).optional(),
  handoffReady: z.boolean().optional(),
  identityState: z.enum(['unverified', 'pending_match', 'verified']).optional(),
  memoryLoaded: z.boolean().optional(),
  verificationHint: z.string().optional()
});

export const adminBriefPatchSchema = z.object({
  fullName: z.string().max(120).optional(),
  email: z.string().email().max(160).optional(),
  phone: z.string().max(40).optional(),
  telegramHandle: z.string().max(64).optional(),
  serviceType: z.string().max(120).optional(),
  primaryGoal: z.string().max(600).optional(),
  firstDeliverable: z.string().max(600).optional(),
  timelineHint: z.string().max(240).optional(),
  budgetHint: z.string().max(240).optional(),
  referralSource: z.string().max(240).optional(),
  constraints: z.string().max(1000).optional(),
  note: z.string().max(500).optional()
});

export const adminHandoffSchema = z.object({
  mode: z.enum(['normal', 'expedite']).optional().default('normal'),
  note: z.string().max(500).optional(),
  intentScore: z.number().int().min(0).max(100).optional(),
  missingFieldsAtHandoff: z.array(z.string()).optional()
});

export const adminVerifyLinkSchema = z.object({
  action: z.enum(['approve', 'reject', 'force_merge']),
  targetCustomerId: z.string().uuid().optional(),
  note: z.string().max(500).optional()
});

export const adminMarkReadSchema = z.object({
  mode: z.enum(['read']).optional().default('read')
});

export const adminBulkReadSchema = z.object({
  conversationIds: z.array(z.string().uuid()).min(1).max(500)
});
