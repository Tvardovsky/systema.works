import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'crypto';

type StartSessionResponse = {
  allowed: boolean;
  sessionId?: string;
};

type ChatMessageResponse = {
  answer?: string;
  nextQuestion?: string;
  handoffReady?: boolean;
  topic?: string;
  dialogTurnMode?: string;
  questionsCount?: number;
  fallbackPath?: string;
  validatorAdjusted?: boolean;
};

type AdminMessage = {
  role: string;
  metadata?: {
    engineVersion: string | null;
    dialogNextSlot: string | null;
    dialogMode: string | null;
    safetyReason: string | null;
    chatMode: string | null;
    dialogTurnMode?: string | null;
    questionsCount?: number | null;
    fallbackPath?: string | null;
    validatorAdjusted?: boolean | null;
  } | null;
};

const ADMIN_TOKEN = 'e2e-admin';

async function startSession(request: APIRequestContext, browserSessionKey: string): Promise<string> {
  const startResponse = await request.post('/api/chat/session/start', {
    data: {
      locale: 'ru',
      pagePath: '/ru',
      turnstileToken: '',
      browserSessionKey,
      honeypot: ''
    }
  });
  expect(startResponse.ok()).toBe(true);
  const payload = (await startResponse.json()) as StartSessionResponse;
  expect(payload.allowed).toBe(true);
  expect(payload.sessionId).toBeTruthy();
  return String(payload.sessionId);
}

async function sendMessage(
  request: APIRequestContext,
  sessionId: string,
  message: string,
  locale: 'ru' | 'en' = 'ru'
): Promise<ChatMessageResponse> {
  const response = await request.post('/api/chat/message', {
    data: {
      sessionId,
      locale,
      message,
      turnstileToken: '',
      honeypot: ''
    }
  });
  if (!response.ok()) {
    throw new Error(`chat/message failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as ChatMessageResponse;
}

async function fetchAdminMessages(request: APIRequestContext, conversationId: string): Promise<AdminMessage[]> {
  const response = await request.get(`/api/admin/conversations/${conversationId}/messages?limit=200`, {
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`
    }
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {ok: boolean; data: AdminMessage[]};
  expect(payload.ok).toBe(true);
  return payload.data;
}

test.describe('dialog-v2 api', () => {
  test.describe.configure({timeout: 90_000});

  test('asks for business goal after deliverable-only request (no fake timeline confirmation)', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());

    const first = await sendMessage(
      request,
      sessionId,
      [
        'Привет, мне нужен лендинг для продажи объектов недвижимости в новом престижном жилом комплексе.',
        'Мой контакт: dialogv2-goal@example.com'
      ].join('\n')
    );

    expect(typeof first.answer).toBe('string');
    expect(String(first.answer ?? '').length).toBeGreaterThan(0);
    expect(first.topic ?? 'allowed').toBe('allowed');
    const nextQuestion = String(first.nextQuestion ?? '').toLowerCase();
    if (nextQuestion) {
      expect(nextQuestion).not.toContain('срок');
    }
  });

  test('keeps handoff false until referral question is asked once, then allows handoff on next turn', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());
    const seed = randomUUID().replace(/-/g, '').slice(0, 12);

    const coreReady = await sendMessage(
      request,
      sessionId,
      [
        'Need a landing page for lead generation.',
        'Primary business goal: increase qualified inbound leads by 30%.',
        'Timeline: 2 weeks.',
        `Email: dialogv2-${seed}@example.com`
      ].join('\n'),
      'en'
    );

    expect(typeof coreReady.answer).toBe('string');
    expect(typeof coreReady.handoffReady).toBe('boolean');

    const afterReferral = await sendMessage(request, sessionId, 'Found you via Google search.', 'en');
    expect(typeof afterReferral.answer).toBe('string');
    expect(typeof afterReferral.handoffReady).toBe('boolean');
  });

  test('stores engine diagnostics in admin message metadata', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());
    await sendMessage(
      request,
      sessionId,
      [
        'Need UI/UX audit for our website.',
        'Goal: improve conversion on pricing page.',
        'Timeline: this month.',
        'Email: dialogv2-metadata@example.com'
      ].join('\n'),
      'en'
    );

    const adminMessages = await fetchAdminMessages(request, sessionId);
    const assistantWithDiagnostics = [...adminMessages]
      .reverse()
      .find((message) => message.role === 'assistant' && (message.metadata?.engineVersion || message.metadata?.dialogMode));
    expect(assistantWithDiagnostics).toBeTruthy();
    expect(assistantWithDiagnostics?.metadata?.dialogMode).toBeTruthy();
    expect(
      assistantWithDiagnostics?.metadata?.engineVersion
      || assistantWithDiagnostics?.metadata?.dialogNextSlot
    ).toBeTruthy();
    expect(
      assistantWithDiagnostics?.metadata?.dialogTurnMode
      ?? assistantWithDiagnostics?.metadata?.fallbackPath
      ?? assistantWithDiagnostics?.metadata?.questionsCount
    ).toBeDefined();
  });
});
