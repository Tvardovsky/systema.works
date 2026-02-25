import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'crypto';

type StartSessionResponse = {
  allowed: boolean;
  sessionId?: string;
};

type LeadPipelineItem = {
  conversation: {
    id: string;
  };
  dialog?: {
    readiness: 'ready' | 'not_ready';
    missingCoreSlots: string[];
    nextSlot: string | null;
    engineVersion: string | null;
    hasStructuredBrief: boolean;
  };
};

const ADMIN_TOKEN = 'e2e-admin';

async function startSession(request: APIRequestContext, browserSessionKey: string): Promise<string> {
  const response = await request.post('/api/chat/session/start', {
    data: {
      locale: 'en',
      pagePath: '/en',
      turnstileToken: '',
      browserSessionKey,
      honeypot: ''
    }
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as StartSessionResponse;
  expect(payload.allowed).toBe(true);
  expect(payload.sessionId).toBeTruthy();
  return String(payload.sessionId);
}

async function sendMessage(request: APIRequestContext, sessionId: string, message: string): Promise<void> {
  const response = await request.post('/api/chat/message', {
    data: {
      sessionId,
      locale: 'en',
      message,
      turnstileToken: '',
      honeypot: ''
    }
  });
  expect(response.ok()).toBe(true);
}

async function fetchPipeline(request: APIRequestContext, query: string): Promise<LeadPipelineItem[]> {
  const response = await request.get(`/api/admin/leads?${query}`, {
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`
    }
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {ok: boolean; data: LeadPipelineItem[]};
  expect(payload.ok).toBe(true);
  return payload.data;
}

async function waitForConversationInPipeline(
  request: APIRequestContext,
  conversationId: string,
  query = 'view=pipeline&limit=250&sort=updated_desc'
): Promise<LeadPipelineItem | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await fetchPipeline(request, query);
    const matched = rows.find((row) => row.conversation.id === conversationId);
    if (matched) {
      return matched;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

test.describe('admin leads v2 api', () => {
  test.describe.configure({timeout: 90_000});

  test('returns dialog projection and readiness filter for ready lead', async ({request}) => {
    const seed = `ready-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const sessionId = await startSession(request, randomUUID());

    await sendMessage(
      request,
      sessionId,
      [
        `Need a landing page project ${seed}.`,
        `Primary goal: increase qualified inbound leads for ${seed}.`,
        'Timeline: 2 weeks.',
        `Email: ${seed}@example.com`
      ].join('\n')
    );

    const found = await waitForConversationInPipeline(request, sessionId);
    expect(found).toBeTruthy();

    const readyFiltered = await fetchPipeline(
      request,
      'view=pipeline&limit=250&readiness=ready&sort=updated_desc'
    );
    const readyItem = readyFiltered.find((row) => row.conversation.id === sessionId);
    expect(readyItem).toBeTruthy();
    expect(readyItem?.dialog?.readiness).toBe('ready');
    expect(typeof readyItem?.dialog?.hasStructuredBrief).toBe('boolean');
  });

  test('supports missingSlot and nextSlot filters for not-ready lead', async ({request}) => {
    const seed = `missing-goal-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const sessionId = await startSession(request, randomUUID());

    await sendMessage(
      request,
      sessionId,
      [
        `Service type: landing page development ${seed}.`,
        `Primary goal: increase qualified inbound leads for ${seed}.`,
        'Timeline: 3 weeks.',
        'No contact yet.'
      ].join('\n')
    );

    const found = await waitForConversationInPipeline(
      request,
      sessionId,
      'view=pipeline&limit=250&readiness=not_ready&sort=updated_desc'
    );
    expect(found).toBeTruthy();
    const missingSlot = found?.dialog?.missingCoreSlots?.[0];
    const nextSlot = found?.dialog?.nextSlot;
    expect(missingSlot).toBeTruthy();
    expect(nextSlot).toBeTruthy();

    const missingGoal = await fetchPipeline(
      request,
      `view=pipeline&limit=250&missingSlot=${encodeURIComponent(String(missingSlot))}&sort=updated_desc`
    );
    const missingGoalItem = missingGoal.find((row) => row.conversation.id === sessionId);
    expect(missingGoalItem).toBeTruthy();
    expect(missingGoalItem?.dialog?.missingCoreSlots ?? []).toContain(String(missingSlot));

    const nextPrimaryGoal = await fetchPipeline(
      request,
      `view=pipeline&limit=250&nextSlot=${encodeURIComponent(String(nextSlot))}&sort=updated_desc`
    );
    const nextSlotItem = nextPrimaryGoal.find((row) => row.conversation.id === sessionId);
    expect(nextSlotItem).toBeTruthy();
    expect(nextSlotItem?.dialog?.nextSlot).toBe(String(nextSlot));
  });
});
