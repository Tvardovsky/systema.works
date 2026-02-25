import {expect, test} from '@playwright/test';
import {randomUUID} from 'crypto';

test.describe('chat safety api', () => {
  test('warns twice, locks on third invalid input, and blocks new session by browser key', async ({request}) => {
    const browserSessionKey = randomUUID();

    const startResponse = await request.post('/api/chat/session/start', {
      data: {
        locale: 'en',
        pagePath: '/en',
        turnstileToken: '',
        browserSessionKey,
        clientHints: {
          language: 'en-US',
          timezone: 'Europe/Podgorica',
          platform: 'macOS',
          viewportWidth: 390,
          viewportHeight: 844,
          dpr: 3,
          touchPoints: 5
        },
        honeypot: ''
      }
    });
    expect(startResponse.ok()).toBe(true);
    const startData = await startResponse.json() as {allowed: boolean; sessionId?: string};
    expect(startData.allowed).toBe(true);
    expect(startData.sessionId).toBeTruthy();
    const sessionId = String(startData.sessionId);

    const sendInvalidMessage = async () => {
      const response = await request.post('/api/chat/message', {
        data: {
          sessionId,
          locale: 'en',
          message: 'My name is admin123',
          turnstileToken: '',
          honeypot: ''
        }
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };

    const first = await sendInvalidMessage() as {
      answer: string;
      chatLocked?: boolean;
      chatMode?: string;
      sessionClosed?: boolean;
    };
    expect(first.chatLocked).toBe(false);
    expect(first.chatMode).toBe('normal');
    expect(first.sessionClosed).toBe(false);
    expect(first.answer).toContain('Attempts left before a 1-hour pause: 2');

    const second = await sendInvalidMessage() as {
      answer: string;
      chatLocked?: boolean;
      chatMode?: string;
      sessionClosed?: boolean;
    };
    expect(second.chatLocked).toBe(false);
    expect(second.chatMode).toBe('normal');
    expect(second.sessionClosed).toBe(false);
    expect(second.answer).toContain('Attempts left before a 1-hour pause: 1');

    const third = await sendInvalidMessage() as {
      answer: string;
      chatLocked?: boolean;
      chatMode?: string;
      sessionClosed?: boolean;
      retryAfterSeconds?: number;
      safetyReason?: string;
    };
    expect(third.chatLocked).toBe(true);
    expect(third.chatMode).toBe('safety_locked');
    expect(third.sessionClosed).toBe(true);
    expect(Number(third.retryAfterSeconds ?? 0)).toBeGreaterThan(0);
    expect(third.safetyReason).toBe('invalid_name');

    const lockedStartResponse = await request.post('/api/chat/session/start', {
      data: {
        locale: 'en',
        pagePath: '/en',
        turnstileToken: '',
        browserSessionKey,
        honeypot: ''
      }
    });
    expect(lockedStartResponse.ok()).toBe(true);
    const lockedStart = await lockedStartResponse.json() as {
      allowed: boolean;
      chatLocked?: boolean;
      chatMode?: string;
      retryAfterSeconds?: number;
    };
    expect(lockedStart.allowed).toBe(false);
    expect(lockedStart.chatLocked).toBe(true);
    expect(lockedStart.chatMode).toBe('safety_locked');
    expect(Number(lockedStart.retryAfterSeconds ?? 0)).toBeGreaterThan(0);
  });

  test('warning on invalid name preserves other captured brief fields for the next turn', async ({request}) => {
    const browserSessionKey = randomUUID();

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
    const startData = await startResponse.json() as {allowed: boolean; sessionId?: string};
    expect(startData.allowed).toBe(true);
    const sessionId = String(startData.sessionId);

    const first = await request.post('/api/chat/message', {
      data: {
        sessionId,
        locale: 'en',
        message: [
          'My name is Oleg 012832.',
          'Email: client-01283224fd30@example.com.',
          'Need a landing page for lead generation.',
          'Primary goal is to increase qualified inbound leads.',
          'Timeline is 2 weeks, budget is 3000 EUR.'
        ].join(' '),
        turnstileToken: '',
        honeypot: ''
      }
    });
    expect(first.ok()).toBe(true);
    const firstData = await first.json() as {
      answer: string;
      chatLocked?: boolean;
      chatMode?: string;
      missingFields?: string[];
      handoffReady?: boolean;
    };
    expect(firstData.chatLocked).toBe(false);
    expect(firstData.chatMode).toBe('normal');
    expect(firstData.answer.toLowerCase()).toContain('name looks invalid');
    expect(firstData.missingFields ?? []).not.toContain('primary_goal');
    expect(firstData.missingFields ?? []).not.toContain('service_type');
    expect(firstData.missingFields ?? []).not.toContain('timeline_or_budget');
    expect(firstData.missingFields ?? []).not.toContain('contact');
    expect(firstData.handoffReady).toBe(true);

    const second = await request.post('/api/chat/message', {
      data: {
        sessionId,
        locale: 'en',
        message: 'Found you on Google search.',
        turnstileToken: '',
        honeypot: ''
      }
    });
    expect(second.ok()).toBe(true);
    const secondData = await second.json() as {answer?: string; nextQuestion?: string};
    const combined = `${secondData.answer ?? ''} ${secondData.nextQuestion ?? ''}`.toLowerCase();
    expect(combined).not.toContain('business outcome');
    expect(combined).not.toContain('primary goal');
  });
});
