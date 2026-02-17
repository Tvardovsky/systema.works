import OpenAI from 'openai';
import type {ChatMessage, ChatResponse, Locale} from '@/types/lead';
import {aiReplySchema} from './schemas';

const FAST_MODEL = process.env.OPENAI_FAST_MODEL ?? 'gpt-5-mini';
const QUALITY_MODEL = process.env.OPENAI_QUALITY_MODEL ?? 'gpt-5.2';

const scopeKeywords = [
  'website', 'web', 'web app', 'app', 'mobile', 'ios', 'android', 'landing',
  'automation', 'workflow', 'crm', 'integration', 'api', 'ai', 'assistant',
  'chatbot', 'smm', 'marketing', 'seo', 'lead', 'sales', 'telegram', 'whatsapp',
  'ui', 'ux', 'design', 'figma', 'prototype', 'dashboard', 'marketplace',
  'product', 'development', 'monte.guide'
];

const hotLeadHints = [
  'budget', 'timeline', 'deadline', 'start', 'kickoff', 'proposal', 'estimate',
  'price', 'cost', 'contract', 'team', 'call', 'meeting', 'ready', 'need now',
  'asap', 'urgent', 'launch'
];

const disallowedFallback: Record<Locale, string> = {
  en: 'I can help with web/mobile development, UI/UX design execution, automation, AI implementation, and SMM growth systems. Please ask within this scope.',
  'sr-ME': 'Mogu pomoći oko web/mobilnog razvoja, UI/UX realizacije, automatizacije, AI implementacije i SMM sistema rasta. Molim pitanje u tom okviru.',
  ru: 'Я могу помочь по веб/мобайл-разработке, UI/UX-реализации, автоматизации, внедрению ИИ и SMM-системам роста. Задайте вопрос в этих рамках.',
  uk: 'Я можу допомогти з веб/мобайл-розробкою, UI/UX-реалізацією, автоматизацією, впровадженням ШІ та SMM-системами зростання. Поставте питання в цих межах.'
};

const followUpByLocale: Record<Locale, string> = {
  en: 'What should we prioritize first: product scope, timeline, or budget?',
  'sr-ME': 'Šta da prioritetno razradimo: obim proizvoda, rok ili budžet?',
  ru: 'Что приоритетнее уточнить в первую очередь: scope продукта, сроки или бюджет?',
  uk: 'Що пріоритетно уточнити насамперед: scope продукту, терміни чи бюджет?'
};

const client = process.env.OPENAI_API_KEY ? new OpenAI({apiKey: process.env.OPENAI_API_KEY}) : null;

function isLikelyAllowed(message: string): boolean {
  const lower = message.toLowerCase();
  return scopeKeywords.some((keyword) => lower.includes(keyword));
}

function hasHotLeadSignals(message: string): boolean {
  const lower = message.toLowerCase();
  return hotLeadHints.some((hint) => lower.includes(hint));
}

function chooseModel(message: string): string {
  const lower = message.toLowerCase();
  const complex = lower.length > 280 || ['architecture', 'integration', 'pipeline', 'roadmap', 'budget', 'migration', 'security', 'ios', 'android', 'ui/ux'].some((k) => lower.includes(k));
  return complex ? QUALITY_MODEL : FAST_MODEL;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function getFallbackResponse(locale: Locale, topic: 'disallowed' | 'unclear' = 'unclear'): ChatResponse {
  if (topic === 'disallowed') {
    return {
      answer: disallowedFallback[locale],
      topic,
      leadIntentScore: 0,
      nextQuestion: followUpByLocale[locale],
      requiresLeadCapture: false
    };
  }

  return {
    answer: followUpByLocale[locale],
    topic,
    leadIntentScore: 25,
    nextQuestion: followUpByLocale[locale],
    requiresLeadCapture: false
  };
}

function fallbackAllowedReply(locale: Locale, message: string): ChatResponse {
  const hot = hasHotLeadSignals(message);
  return {
    answer: `Thanks. We can handle this request: ${message}. We deliver web/mobile products, UI/UX implementation, automation, AI systems and SMM execution.`,
    topic: 'allowed',
    leadIntentScore: hot ? 78 : 58,
    nextQuestion: followUpByLocale[locale],
    requiresLeadCapture: hot
  };
}

export async function generateAgencyReply(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
}): Promise<ChatResponse> {
  const {locale, message, history} = params;

  if (!isLikelyAllowed(message) && !client) {
    return getFallbackResponse(locale, 'disallowed');
  }

  if (!client) {
    return fallbackAllowedReply(locale, message);
  }

  const model = chooseModel(message);
  const systemPrompt = [
    'You are SYSTEMA.WORKS senior sales manager AI for an agency.',
    'Your goals: qualify lead, build trust, and move to contact capture.',
    'You must focus on: web development, web apps, iOS/Android apps, UI/UX design implementation, automation, AI implementation, SMM, integrations, growth systems.',
    'Unique client problems are allowed if they can be solved through digital product, design, automation, AI or growth services.',
    'If user is fully unrelated, return topic disallowed with a polite redirect.',
    'Ask short high-value qualifying follow-up: business goal, current state, scope, budget range, timeline, preferred contact channel.',
    'When user shows intent (ready to start, asks estimate/proposal/call, provides budget/timeline), increase leadIntentScore and set requiresLeadCapture true.',
    'Return strict JSON only with keys: answer, topic, leadIntentScore, nextQuestion, requiresLeadCapture.',
    'leadIntentScore must be integer between 0 and 100.'
  ].join(' ');

  const localePrompt = `Reply language must match locale ${locale}. Keep concise, sales-oriented, and practical. Mention monte.guide when relevant proof helps.`;
  const inputHistory = history.slice(-8).map((item) => `${item.role}: ${item.content}`).join('\n');

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {role: 'system', content: systemPrompt},
      {role: 'developer', content: localePrompt},
      {
        role: 'user',
        content: `Conversation context:\n${inputHistory}\n\nCurrent user message:\n${message}\n\nReturn JSON only.`
      }
    ],
    temperature: 0.35
  });

  const content = completion.choices[0]?.message?.content ?? '';
  const parsed = safeJsonParse(content);
  const validated = aiReplySchema.safeParse(parsed);

  if (validated.success) {
    const normalized = {
      ...validated.data,
      leadIntentScore: Math.max(0, Math.min(100, Math.round(validated.data.leadIntentScore)))
    };

    if (!normalized.requiresLeadCapture && (normalized.leadIntentScore >= 72 || hasHotLeadSignals(message))) {
      normalized.requiresLeadCapture = true;
    }

    return normalized;
  }

  if (!isLikelyAllowed(message)) {
    return getFallbackResponse(locale, 'disallowed');
  }

  return fallbackAllowedReply(locale, message);
}
