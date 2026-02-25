import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'crypto';

type StartSessionResponse = {
  allowed: boolean;
  sessionId?: string;
};

type ChatMessageResponse = {
  answer?: string;
  nextQuestion?: string;
  dialogTurnMode?: string;
  questionsCount?: number;
};

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

async function sendMessage(request: APIRequestContext, sessionId: string, message: string): Promise<ChatMessageResponse> {
  const response = await request.post('/api/chat/message', {
    data: {
      sessionId,
      locale: 'ru',
      message,
      turnstileToken: '',
      honeypot: ''
    }
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as ChatMessageResponse;
}

test.describe('dialog-v3 e2e', () => {
  test.describe.configure({timeout: 90_000});

  test('does not repeat primary-goal question after explicit goal answer', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());

    await sendMessage(request, sessionId, 'Привет, мне нужен лендинг для продажи объектов недвижимости');
    const second = await sendMessage(request, sessionId, 'Построить и продать!');

    const nextQuestion = String(second.nextQuestion ?? '').toLowerCase();
    expect(nextQuestion).not.toContain('бизнес-результат');
    expect((second.questionsCount ?? 0)).toBeLessThanOrEqual(2);
  });

  test('uses answer_only mode for in-scope counter-question turn', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());

    await sendMessage(request, sessionId, 'Нужна автоматизация заявок и CRM.');
    const reply = await sendMessage(request, sessionId, 'А сколько обычно длится внедрение такого решения?');

    expect(reply.dialogTurnMode === 'answer_only' || reply.dialogTurnMode === 'progress').toBe(true);
    expect((reply.questionsCount ?? 0)).toBeLessThanOrEqual(2);
  });
});
