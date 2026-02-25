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
});
