import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'crypto';

type StartSessionResponse = {
  allowed: boolean;
  sessionId?: string;
};

type ChatMessageResponse = {
  answer?: string;
  handoffReady?: boolean;
};

const CORE_BRIEF_MESSAGE = [
  'I am Oleg',
  'Phone: +38268291324',
  'Need a landing page for lead generation.',
  'Timeline is 2 weeks, budget is 3000 EUR.'
].join('\n');

async function startSession(request: APIRequestContext, browserSessionKey: string): Promise<string> {
  const startResponse = await request.post('/api/chat/session/start', {
    data: {
      locale: 'en',
      pagePath: '/en',
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
  message: string
): Promise<ChatMessageResponse> {
  const response = await request.post('/api/chat/message', {
    data: {
      sessionId,
      locale: 'en',
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

test.describe('referral source capture api', () => {
  test('asks referral question once after core brief and captures valid source', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());

    const first = await sendMessage(
      request,
      sessionId,
      CORE_BRIEF_MESSAGE
    );
    expect(first.handoffReady).toBe(false);

    const second = await sendMessage(request, sessionId, 'Found you on Google search.');
    expect(second.handoffReady).toBe(true);
  });

  test('does not block handoff when referral answer stays invalid after the question was asked', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());

    const first = await sendMessage(
      request,
      sessionId,
      CORE_BRIEF_MESSAGE
    );
    expect(first.handoffReady).toBe(false);

    const second = await sendMessage(request, sessionId, 'ok');
    expect(second.handoffReady).toBe(true);
  });
});
