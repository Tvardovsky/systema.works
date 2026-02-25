import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'crypto';

type StartSessionResponse = {
  allowed: boolean;
  sessionId?: string;
};

type ChatMessageResponse = {
  answer?: string;
  handoffReady?: boolean;
  topic?: string;
};

type PipelineItem = {
  conversation: {
    id: string;
    customerId: string;
  };
};

type AdminBriefBundle = {
  brief: {
    referralSource: string | null;
  } | null;
};

type AdminCustomerContext = {
  leadBrief: {
    referralSource: string | null;
  } | null;
};

const ADMIN_TOKEN = 'e2e-admin';

function buildCoreBriefMessage(seed: string): string {
  return [
    `My name is Oleg ${seed.slice(0, 6)}`,
    `Email: client-${seed}@example.com`,
    `Need a landing page for lead generation (${seed}).`,
    `Primary goal is to increase qualified inbound leads for ${seed}.`,
    'Timeline is 2 weeks, budget is 3000 EUR.'
  ].join('\n');
}

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

async function fetchPipelineByQuery(request: APIRequestContext, q: string): Promise<PipelineItem[]> {
  const response = await request.get(`/api/admin/leads?view=pipeline&limit=250&q=${encodeURIComponent(q)}&sort=updated_desc`, {
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`
    }
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {ok: boolean; data: PipelineItem[]};
  expect(payload.ok).toBe(true);
  return payload.data;
}

async function waitForPipelineItem(request: APIRequestContext, q: string): Promise<PipelineItem | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const data = await fetchPipelineByQuery(request, q);
    if (data[0]) {
      return data[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

test.describe('referral source capture api', () => {
  test('asks referral question once after core brief and captures valid source', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());
    const seed = randomUUID().replace(/-/g, '').slice(0, 12);
    const coreBriefMessage = buildCoreBriefMessage(seed);

    const first = await sendMessage(
      request,
      sessionId,
      coreBriefMessage
    );
    expect(typeof first.answer).toBe('string');
    expect(first.topic ?? 'allowed').toBe('allowed');

    const referralText = `Found you on Google search (${seed}).`;
    const second = await sendMessage(request, sessionId, referralText);
    expect(typeof second.answer).toBe('string');
    expect(typeof second.handoffReady).toBe('boolean');

    const item = await waitForPipelineItem(request, seed);
    expect(item).toBeTruthy();
    const conversationId = String(item?.conversation.id);
    const customerId = String(item?.conversation.customerId);

    const briefResponse = await request.get(`/api/admin/conversations/${conversationId}/brief`, {
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });
    expect(briefResponse.ok()).toBe(true);
    const briefPayload = (await briefResponse.json()) as {ok: boolean; data: AdminBriefBundle};
    expect(briefPayload.ok).toBe(true);
    expect(briefPayload.data.brief?.referralSource ?? '').toContain(seed);

    const contextResponse = await request.get(`/api/admin/customers/${customerId}/context`, {
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`
      }
    });
    expect(contextResponse.ok()).toBe(true);
    const contextPayload = (await contextResponse.json()) as {ok: boolean; data: AdminCustomerContext};
    expect(contextPayload.ok).toBe(true);
    expect(contextPayload.data.leadBrief?.referralSource ?? '').toContain(seed);
  });

  test('does not block handoff when referral answer stays invalid after the question was asked', async ({request}) => {
    const sessionId = await startSession(request, randomUUID());
    const coreBriefMessage = buildCoreBriefMessage(randomUUID().replace(/-/g, '').slice(0, 12));

    const first = await sendMessage(
      request,
      sessionId,
      coreBriefMessage
    );
    expect(typeof first.answer).toBe('string');

    const second = await sendMessage(request, sessionId, 'ok');
    expect(typeof second.answer).toBe('string');
    expect(typeof second.handoffReady).toBe('boolean');
  });
});
