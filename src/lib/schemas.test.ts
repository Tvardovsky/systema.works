import {describe, expect, it} from 'bun:test';
import {startSessionSchema} from './schemas';

describe('startSessionSchema', () => {
  it('accepts optional client hints', () => {
    const parsed = startSessionSchema.safeParse({
      locale: 'en',
      pagePath: '/en',
      browserSessionKey: '8f0d1167-4528-4498-835a-a4f821d5346f',
      clientHints: {
        language: 'en-US',
        timezone: 'Europe/Podgorica',
        platform: 'macOS',
        viewportWidth: 390,
        viewportHeight: 844,
        dpr: 3,
        touchPoints: 5
      }
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.clientHints?.language).toBe('en-US');
      expect(parsed.data.clientHints?.viewportWidth).toBe(390);
    }
  });

  it('rejects invalid client hints values', () => {
    const parsed = startSessionSchema.safeParse({
      locale: 'en',
      pagePath: '/en',
      browserSessionKey: '8f0d1167-4528-4498-835a-a4f821d5346f',
      clientHints: {
        viewportWidth: -20
      }
    });

    expect(parsed.success).toBe(false);
  });
});
