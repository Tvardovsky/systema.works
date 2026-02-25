import {expect, test} from '@playwright/test';
import {randomUUID} from 'crypto';

test.describe('web session idempotency', () => {
  test('parallel start requests with the same browserSessionKey reuse one session', async ({request}) => {
    const browserSessionKey = randomUUID();
    const payload = {
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
    };

    const responses = await Promise.all(
      Array.from({length: 8}, () => request.post('/api/chat/session/start', {data: payload}))
    );

    for (const response of responses) {
      expect(response.ok()).toBe(true);
    }

    const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{
      allowed: boolean;
      sessionId?: string;
      reused?: boolean;
      sessionSource?: 'existing_session' | 'browser_key' | 'created' | 'conflict_reused';
    }>;
    const uniqueSessionIds = Array.from(new Set(
      bodies
        .map((body) => body.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    ));

    expect(uniqueSessionIds).toHaveLength(1);
    for (const body of bodies) {
      expect(body.allowed).toBe(true);
      expect(body.sessionId).toBe(uniqueSessionIds[0]);
    }

    const observedSources = new Set(bodies.map((body) => body.sessionSource).filter(Boolean));
    expect(observedSources.size).toBeGreaterThanOrEqual(1);
  });
});
