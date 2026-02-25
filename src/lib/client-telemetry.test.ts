import {afterAll, beforeEach, describe, expect, it} from 'bun:test';
import {
  aggregateTechnicalSignals,
  extractServerClientSignal,
  hashIp,
  maskIp,
  mergeClientTelemetry,
  parseCountryFromHeaders,
  parseUserAgent
} from './client-telemetry';

const ORIGINAL_SALT = process.env.CHAT_IP_HASH_SALT;

beforeEach(() => {
  process.env.CHAT_IP_HASH_SALT = 'unit-test-salt';
});

afterAll(() => {
  if (ORIGINAL_SALT === undefined) {
    delete process.env.CHAT_IP_HASH_SALT;
    return;
  }
  process.env.CHAT_IP_HASH_SALT = ORIGINAL_SALT;
});

function snapshotWithPath(path: string) {
  const headers = new Headers({
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9'
  });
  return extractServerClientSignal({
    request: {headers},
    ip: '10.24.8.91',
    locale: 'en',
    pagePath: path
  });
}

describe('client telemetry helpers', () => {
  it('masks IPv4 and IPv6 addresses', () => {
    expect(maskIp('192.168.11.99')).toBe('192.168.11.0/24');
    expect(maskIp('2a02:6b8:b010:9020:0:0:0:1')).toBe('2a02:06b8:b010:9020::/64');
  });

  it('hashes IP with configured salt', () => {
    const first = hashIp('203.0.113.7');
    const second = hashIp('203.0.113.7');
    expect(first).toBeTruthy();
    expect(first).toHaveLength(64);
    expect(second).toBe(first);
  });

  it('uses country header precedence', () => {
    const headers = new Headers({
      'x-vercel-ip-country': 'US',
      'cf-ipcountry': 'CA',
      'x-country-code': 'DE',
      'x-vercel-ip-country-region': 'CA',
      'x-vercel-ip-city': 'San Francisco'
    });
    const country = parseCountryFromHeaders(headers);
    expect(country.countryCode).toBe('US');
    expect(country.countryRegion).toBe('CA');
    expect(country.city).toBe('San Francisco');
  });

  it('parses desktop/mobile/bot user agents', () => {
    const desktop = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
    );
    const mobile = parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1'
    );
    const bot = parseUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    );

    expect(desktop.browserFamily).toBe('Chrome');
    expect(desktop.osFamily).toBe('Windows');
    expect(desktop.deviceType).toBe('desktop');
    expect(desktop.isBot).toBe(false);

    expect(mobile.browserFamily).toBe('Safari');
    expect(mobile.osFamily).toBe('iOS');
    expect(mobile.deviceType).toBe('mobile');
    expect(mobile.isBot).toBe(false);

    expect(bot.deviceType).toBe('bot');
    expect(bot.isBot).toBe(true);
  });

  it('merges, prunes by TTL, and caps history at 20 entries', () => {
    let telemetry = mergeClientTelemetry(
      null,
      snapshotWithPath('/old'),
      'session_start',
      new Date('2026-01-01T10:00:00Z')
    );

    for (let index = 0; index < 24; index += 1) {
      telemetry = mergeClientTelemetry(
        telemetry,
        snapshotWithPath(`/p-${index}`),
        'message',
        new Date(2026, 1, 1, 12, index, 0)
      );
    }

    expect(telemetry.stats.sessionStarts).toBe(1);
    expect(telemetry.stats.messages).toBe(24);
    expect(telemetry.history.pagePaths.length).toBe(20);
    expect(telemetry.history.pagePaths.some((entry) => entry.path === '/old')).toBe(false);
    expect(telemetry.history.ips.length).toBe(1);
    expect(telemetry.history.ips[0]?.hits).toBeGreaterThanOrEqual(20);
  });

  it('aggregates technical signals from multiple conversations', () => {
    const telemetryA = mergeClientTelemetry(
      null,
      snapshotWithPath('/pricing'),
      'session_start',
      new Date('2026-02-01T08:00:00Z')
    );
    const telemetryB = mergeClientTelemetry(
      null,
      extractServerClientSignal({
        request: {
          headers: new Headers({
            'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36',
            'x-vercel-ip-country': 'GB'
          })
        },
        ip: '198.51.100.24',
        locale: 'en',
        pagePath: '/contact'
      }),
      'session_start',
      new Date('2026-02-02T09:00:00Z')
    );

    const aggregate = aggregateTechnicalSignals([
      {metadata: {clientTelemetry: telemetryA}},
      {metadata: {clientTelemetry: telemetryB}}
    ]);

    expect(aggregate).not.toBeNull();
    expect(aggregate?.uniqueIpCount90d).toBe(2);
    expect(aggregate?.uniqueCountryCount90d).toBeGreaterThanOrEqual(1);
    expect(aggregate?.recentAgents.length).toBeGreaterThanOrEqual(1);
    expect(aggregate?.lastDeviceType).toBe('mobile');
  });
});
