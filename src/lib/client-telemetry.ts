import {createHash} from 'crypto';
import {isIP} from 'net';

type TelemetryLocale = 'en' | 'sr-ME' | 'ru' | 'uk';
type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
type BrowserFamily = 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Opera' | 'Unknown';
type OsFamily = 'iOS' | 'Android' | 'macOS' | 'Windows' | 'Linux' | 'Unknown';

export type ClientTelemetryEventType = 'session_start' | 'message';

export type ClientHintsInput = {
  language?: string | null;
  timezone?: string | null;
  platform?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  dpr?: number | null;
  touchPoints?: number | null;
} | null | undefined;

export type ClientTelemetrySnapshot = {
  ipRaw: string | null;
  ipMasked: string | null;
  ipHash: string | null;
  countryCode: string | null;
  countryRegion: string | null;
  city: string | null;
  userAgentRaw: string | null;
  browserFamily: BrowserFamily | null;
  browserVersion: string | null;
  osFamily: OsFamily | null;
  osVersion: string | null;
  deviceType: DeviceType;
  isBot: boolean;
  acceptLanguage: string | null;
  locale: TelemetryLocale | null;
  pagePath: string | null;
  clientHints: {
    language: string | null;
    timezone: string | null;
    platform: string | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
    dpr: number | null;
    touchPoints: number | null;
  } | null;
};

export type ClientTelemetryV1 = {
  version: 1;
  firstSeenAt: string;
  lastSeenAt: string;
  stats: {
    sessionStarts: number;
    messages: number;
    lastEventType: ClientTelemetryEventType;
  };
  latest: ClientTelemetrySnapshot;
  history: {
    ips: Array<{
      ipRaw: string | null;
      ipMasked: string | null;
      ipHash: string;
      firstSeenAt: string;
      lastSeenAt: string;
      hits: number;
    }>;
    countries: Array<{
      countryCode: string;
      region: string | null;
      city: string | null;
      firstSeenAt: string;
      lastSeenAt: string;
      hits: number;
    }>;
    userAgents: Array<{
      fingerprint: string;
      userAgentRaw: string | null;
      browserFamily: BrowserFamily | null;
      browserVersion: string | null;
      osFamily: OsFamily | null;
      osVersion: string | null;
      deviceType: DeviceType;
      isBot: boolean;
      firstSeenAt: string;
      lastSeenAt: string;
      hits: number;
    }>;
    pagePaths: Array<{
      path: string;
      firstSeenAt: string;
      lastSeenAt: string;
      hits: number;
    }>;
  };
};

export type TechnicalSignalsAggregate = {
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastIpMasked: string | null;
  lastCountry: string | null;
  lastBrowser: string | null;
  lastDeviceType: DeviceType | null;
  uniqueIpCount90d: number;
  uniqueCountryCount90d: number;
  uniqueDeviceCount90d: number;
  recentIps: Array<{
    ipMasked: string | null;
    hits: number;
    lastSeenAt: string;
  }>;
  recentCountries: Array<{
    countryCode: string;
    region: string | null;
    city: string | null;
    hits: number;
    lastSeenAt: string;
  }>;
  recentAgents: Array<{
    browserFamily: BrowserFamily | null;
    browserVersion: string | null;
    osFamily: OsFamily | null;
    osVersion: string | null;
    deviceType: DeviceType;
    isBot: boolean;
    hits: number;
    lastSeenAt: string;
  }>;
};

type TelemetryRecord = Record<string, unknown>;

const TELEMETRY_VERSION = 1 as const;
const DEFAULT_HISTORY_CAP = 20;
const DEFAULT_TTL_DAYS = 90;

function isRecord(value: unknown): value is TelemetryRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLen = 300): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  return normalized.length <= maxLen ? normalized : normalized.slice(0, maxLen);
}

function cleanNullableVersion(value: unknown): string | null {
  const cleaned = cleanText(value, 40);
  return cleaned ? cleaned.replace(/[^0-9A-Za-z._-]/g, '') : null;
}

function normalizeLocale(value: unknown): TelemetryLocale | null {
  return value === 'en' || value === 'sr-ME' || value === 'ru' || value === 'uk' ? value : null;
}

function toSafeNumber(value: unknown, options: {min: number; max: number; integer?: boolean}): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const numeric = options.integer ? Math.floor(value) : value;
  if (numeric < options.min || numeric > options.max) {
    return null;
  }
  return numeric;
}

function normalizeDateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function parseHits(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function parseIsoOrNow(value: unknown, fallbackIso: string): string {
  return normalizeDateOrNull(value) ?? fallbackIso;
}

function compareIsoDesc(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a);
}

function normalizeIp(value: string | null | undefined): string | null {
  const clean = cleanText(value, 120);
  if (!clean || clean.toLowerCase() === 'unknown') {
    return null;
  }
  return clean;
}

function expandIpv6(ip: string): string[] | null {
  const clean = ip.split('%')[0]?.toLowerCase() ?? '';
  if (!clean) {
    return null;
  }
  const doubleColonIndex = clean.indexOf('::');
  if (doubleColonIndex >= 0) {
    const head = clean.slice(0, doubleColonIndex);
    const tail = clean.slice(doubleColonIndex + 2);
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - (headParts.length + tailParts.length);
    if (missing < 0) {
      return null;
    }
    const parts = [...headParts, ...Array.from({length: missing}, () => '0'), ...tailParts];
    if (parts.length !== 8) {
      return null;
    }
    const normalized = parts.map((part) => {
      if (!part || !/^[0-9a-f]{1,4}$/i.test(part)) {
        return null;
      }
      return part.padStart(4, '0').toLowerCase();
    });
    return normalized.every(Boolean) ? (normalized as string[]) : null;
  }

  const parts = clean.split(':');
  if (parts.length !== 8) {
    return null;
  }
  const normalized = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null;
    }
    return part.padStart(4, '0').toLowerCase();
  });
  return normalized.every(Boolean) ? (normalized as string[]) : null;
}

export function maskIp(ip: string | null | undefined): string | null {
  const normalized = normalizeIp(ip);
  if (!normalized) {
    return null;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const parts = normalized.split('.');
    if (parts.length !== 4) {
      return null;
    }
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (ipVersion === 6) {
    const expanded = expandIpv6(normalized);
    if (!expanded) {
      return null;
    }
    return `${expanded.slice(0, 4).join(':')}::/64`;
  }
  return null;
}

function getIpHashSalt(): string | null {
  const envSalt = cleanText(process.env.CHAT_IP_HASH_SALT, 256);
  if (envSalt) {
    return envSalt;
  }
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  return 'dev-chat-ip-hash-salt';
}

export function hashIp(ip: string | null | undefined): string | null {
  const normalized = normalizeIp(ip);
  if (!normalized) {
    return null;
  }
  const salt = getIpHashSalt();
  if (!salt) {
    return null;
  }
  return createHash('sha256').update(`${normalized}:${salt}`).digest('hex');
}

function normalizeCountryCode(value: unknown): string | null {
  const code = cleanText(value, 8)?.toUpperCase() ?? null;
  if (!code || !/^[A-Z]{2}$/.test(code)) {
    return null;
  }
  return code;
}

export function parseCountryFromHeaders(headers: Headers): {
  countryCode: string | null;
  countryRegion: string | null;
  city: string | null;
} {
  const countryCode = normalizeCountryCode(
    headers.get('x-vercel-ip-country')
    ?? headers.get('cf-ipcountry')
    ?? headers.get('x-country-code')
  );
  return {
    countryCode,
    countryRegion: cleanText(headers.get('x-vercel-ip-country-region'), 120),
    city: cleanText(headers.get('x-vercel-ip-city'), 120)
  };
}

function parseWindowsVersion(version: string | null): string | null {
  if (!version) {
    return null;
  }
  if (version === '10.0') {
    return '10/11';
  }
  if (version === '6.3') {
    return '8.1';
  }
  if (version === '6.2') {
    return '8';
  }
  if (version === '6.1') {
    return '7';
  }
  return version;
}

export function parseUserAgent(userAgent: string | null | undefined): {
  browserFamily: BrowserFamily | null;
  browserVersion: string | null;
  osFamily: OsFamily | null;
  osVersion: string | null;
  deviceType: DeviceType;
  isBot: boolean;
} {
  const raw = cleanText(userAgent, 2048);
  if (!raw) {
    return {
      browserFamily: null,
      browserVersion: null,
      osFamily: null,
      osVersion: null,
      deviceType: 'unknown',
      isBot: false
    };
  }

  const lower = raw.toLowerCase();
  const isBot = /(bot|crawler|spider|crawl|headless|facebookexternalhit|slurp|bingpreview|postmanruntime|curl|wget|python-requests)/i.test(raw);

  let deviceType: DeviceType = 'desktop';
  if (isBot) {
    deviceType = 'bot';
  } else if (/(ipad|tablet|playbook|silk)|(android(?!.*mobile))/i.test(lower)) {
    deviceType = 'tablet';
  } else if (/(mobi|iphone|ipod|android|windows phone|iemobile)/i.test(lower)) {
    deviceType = 'mobile';
  }

  let browserFamily: BrowserFamily = 'Unknown';
  let browserVersion: string | null = null;
  let match = raw.match(/(?:Edg|Edge)\/([\d.]+)/i);
  if (match) {
    browserFamily = 'Edge';
    browserVersion = cleanNullableVersion(match[1]);
  } else {
    match = raw.match(/(?:OPR|Opera)\/([\d.]+)/i);
    if (match) {
      browserFamily = 'Opera';
      browserVersion = cleanNullableVersion(match[1]);
    } else {
      match = raw.match(/Firefox\/([\d.]+)/i);
      if (match) {
        browserFamily = 'Firefox';
        browserVersion = cleanNullableVersion(match[1]);
      } else {
        match = raw.match(/(?:Chrome|CriOS)\/([\d.]+)/i);
        if (match) {
          browserFamily = 'Chrome';
          browserVersion = cleanNullableVersion(match[1]);
        } else {
          match = raw.match(/Version\/([\d.]+).*Safari/i);
          if (match) {
            browserFamily = 'Safari';
            browserVersion = cleanNullableVersion(match[1]);
          }
        }
      }
    }
  }

  let osFamily: OsFamily = 'Unknown';
  let osVersion: string | null = null;
  match = raw.match(/Android\s+([\d.]+)/i);
  if (match) {
    osFamily = 'Android';
    osVersion = cleanNullableVersion(match[1]);
  } else {
    match = raw.match(/(?:iPhone|CPU(?: iPhone)? OS|iPad; CPU OS)\s+([\d_]+)/i);
    if (match) {
      osFamily = 'iOS';
      osVersion = cleanNullableVersion(match[1]?.replace(/_/g, '.'));
    } else {
      match = raw.match(/Mac OS X\s+([\d_]+)/i);
      if (match) {
        osFamily = 'macOS';
        osVersion = cleanNullableVersion(match[1]?.replace(/_/g, '.'));
      } else {
        match = raw.match(/Windows NT\s+([\d.]+)/i);
        if (match) {
          osFamily = 'Windows';
          osVersion = parseWindowsVersion(cleanNullableVersion(match[1]));
        } else if (/Linux/i.test(raw)) {
          osFamily = 'Linux';
          osVersion = null;
        }
      }
    }
  }

  return {
    browserFamily,
    browserVersion,
    osFamily,
    osVersion,
    deviceType,
    isBot
  };
}

function normalizePagePath(value: string | null | undefined): string | null {
  const clean = cleanText(value, 500);
  if (!clean) {
    return null;
  }
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      const url = new URL(clean);
      return cleanText(url.pathname, 200);
    } catch {
      return null;
    }
  }
  if (!clean.startsWith('/')) {
    return null;
  }
  return cleanText(clean, 200);
}

export function extractPathFromReferer(referer: string | null | undefined): string | null {
  const clean = cleanText(referer, 1000);
  if (!clean) {
    return null;
  }
  try {
    const url = new URL(clean);
    return normalizePagePath(url.pathname);
  } catch {
    return normalizePagePath(clean);
  }
}

function normalizeClientHints(input: ClientHintsInput): ClientTelemetrySnapshot['clientHints'] {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const language = cleanText(input.language, 32);
  const timezone = cleanText(input.timezone, 100);
  const platform = cleanText(input.platform, 64);
  const viewportWidth = toSafeNumber(input.viewportWidth, {min: 1, max: 12000, integer: true});
  const viewportHeight = toSafeNumber(input.viewportHeight, {min: 1, max: 12000, integer: true});
  const dpr = toSafeNumber(input.dpr, {min: 0.1, max: 10});
  const touchPoints = toSafeNumber(input.touchPoints, {min: 0, max: 20, integer: true});
  if (!language && !timezone && !platform && !viewportWidth && !viewportHeight && !dpr && touchPoints === null) {
    return null;
  }
  return {
    language,
    timezone,
    platform,
    viewportWidth,
    viewportHeight,
    dpr,
    touchPoints
  };
}

export function extractServerClientSignal(params: {
  request: {headers: Headers};
  ip?: string | null;
  locale?: TelemetryLocale | null;
  pagePath?: string | null;
  clientHints?: ClientHintsInput;
}): ClientTelemetrySnapshot {
  const ipRaw = normalizeIp(params.ip);
  const uaRaw = cleanText(params.request.headers.get('user-agent'), 2048);
  const parsedUa = parseUserAgent(uaRaw);
  const country = parseCountryFromHeaders(params.request.headers);
  return {
    ipRaw,
    ipMasked: maskIp(ipRaw),
    ipHash: hashIp(ipRaw),
    countryCode: country.countryCode,
    countryRegion: country.countryRegion,
    city: country.city,
    userAgentRaw: uaRaw,
    browserFamily: parsedUa.browserFamily,
    browserVersion: parsedUa.browserVersion,
    osFamily: parsedUa.osFamily,
    osVersion: parsedUa.osVersion,
    deviceType: parsedUa.deviceType,
    isBot: parsedUa.isBot,
    acceptLanguage: cleanText(params.request.headers.get('accept-language'), 200),
    locale: normalizeLocale(params.locale),
    pagePath: normalizePagePath(params.pagePath ?? null),
    clientHints: normalizeClientHints(params.clientHints)
  };
}

function userAgentFingerprint(snapshot: ClientTelemetrySnapshot): string | null {
  if (!snapshot.userAgentRaw && !snapshot.browserFamily && !snapshot.osFamily && snapshot.deviceType === 'unknown') {
    return null;
  }
  return createHash('sha256')
    .update([
      snapshot.userAgentRaw ?? '',
      snapshot.browserFamily ?? '',
      snapshot.browserVersion ?? '',
      snapshot.osFamily ?? '',
      snapshot.osVersion ?? '',
      snapshot.deviceType,
      snapshot.isBot ? '1' : '0'
    ].join('|'))
    .digest('hex');
}

function createInitialTelemetry(nowIso: string, snapshot: ClientTelemetrySnapshot, eventType: ClientTelemetryEventType): ClientTelemetryV1 {
  return {
    version: TELEMETRY_VERSION,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    stats: {
      sessionStarts: eventType === 'session_start' ? 1 : 0,
      messages: eventType === 'message' ? 1 : 0,
      lastEventType: eventType
    },
    latest: snapshot,
    history: {
      ips: [],
      countries: [],
      userAgents: [],
      pagePaths: []
    }
  };
}

function hydrateTelemetry(raw: unknown, fallbackIso: string): ClientTelemetryV1 | null {
  if (!isRecord(raw) || raw.version !== TELEMETRY_VERSION) {
    return null;
  }
  const latestRaw = isRecord(raw.latest) ? raw.latest : null;
  const latest: ClientTelemetrySnapshot = {
    ipRaw: cleanText(latestRaw?.ipRaw, 120),
    ipMasked: cleanText(latestRaw?.ipMasked, 120),
    ipHash: cleanText(latestRaw?.ipHash, 128),
    countryCode: normalizeCountryCode(latestRaw?.countryCode),
    countryRegion: cleanText(latestRaw?.countryRegion, 120),
    city: cleanText(latestRaw?.city, 120),
    userAgentRaw: cleanText(latestRaw?.userAgentRaw, 2048),
    browserFamily: (cleanText(latestRaw?.browserFamily, 40) as BrowserFamily | null) ?? null,
    browserVersion: cleanNullableVersion(latestRaw?.browserVersion),
    osFamily: (cleanText(latestRaw?.osFamily, 40) as OsFamily | null) ?? null,
    osVersion: cleanNullableVersion(latestRaw?.osVersion),
    deviceType: (cleanText(latestRaw?.deviceType, 20) as DeviceType | null) ?? 'unknown',
    isBot: Boolean(latestRaw?.isBot),
    acceptLanguage: cleanText(latestRaw?.acceptLanguage, 200),
    locale: normalizeLocale(latestRaw?.locale),
    pagePath: normalizePagePath(cleanText(latestRaw?.pagePath, 500)),
    clientHints: normalizeClientHints(isRecord(latestRaw?.clientHints) ? (latestRaw?.clientHints as ClientHintsInput) : null)
  };

  const statsRaw = isRecord(raw.stats) ? raw.stats : null;
  const parsed: ClientTelemetryV1 = {
    version: TELEMETRY_VERSION,
    firstSeenAt: parseIsoOrNow(raw.firstSeenAt, fallbackIso),
    lastSeenAt: parseIsoOrNow(raw.lastSeenAt, fallbackIso),
    stats: {
      sessionStarts: parseHits(statsRaw?.sessionStarts),
      messages: parseHits(statsRaw?.messages),
      lastEventType: statsRaw?.lastEventType === 'session_start' ? 'session_start' : 'message'
    },
    latest,
    history: {
      ips: [],
      countries: [],
      userAgents: [],
      pagePaths: []
    }
  };

  const history = isRecord(raw.history) ? raw.history : null;
  const ips = Array.isArray(history?.ips) ? history.ips : [];
  parsed.history.ips = ips
    .map((item) => (isRecord(item) ? item : null))
    .filter(Boolean)
    .map((item) => ({
      ipRaw: cleanText(item?.ipRaw, 120),
      ipMasked: cleanText(item?.ipMasked, 120),
      ipHash: cleanText(item?.ipHash, 128) ?? '',
      firstSeenAt: parseIsoOrNow(item?.firstSeenAt, fallbackIso),
      lastSeenAt: parseIsoOrNow(item?.lastSeenAt, fallbackIso),
      hits: parseHits(item?.hits)
    }))
    .filter((item) => Boolean(item.ipHash));

  const countries = Array.isArray(history?.countries) ? history.countries : [];
  parsed.history.countries = countries
    .map((item) => (isRecord(item) ? item : null))
    .filter(Boolean)
    .map((item) => ({
      countryCode: normalizeCountryCode(item?.countryCode) ?? '',
      region: cleanText(item?.region, 120),
      city: cleanText(item?.city, 120),
      firstSeenAt: parseIsoOrNow(item?.firstSeenAt, fallbackIso),
      lastSeenAt: parseIsoOrNow(item?.lastSeenAt, fallbackIso),
      hits: parseHits(item?.hits)
    }))
    .filter((item) => Boolean(item.countryCode));

  const userAgents = Array.isArray(history?.userAgents) ? history.userAgents : [];
  parsed.history.userAgents = userAgents
    .map((item) => (isRecord(item) ? item : null))
    .filter(Boolean)
    .map((item) => ({
      fingerprint: cleanText(item?.fingerprint, 128) ?? '',
      userAgentRaw: cleanText(item?.userAgentRaw, 2048),
      browserFamily: (cleanText(item?.browserFamily, 40) as BrowserFamily | null) ?? null,
      browserVersion: cleanNullableVersion(item?.browserVersion),
      osFamily: (cleanText(item?.osFamily, 40) as OsFamily | null) ?? null,
      osVersion: cleanNullableVersion(item?.osVersion),
      deviceType: (cleanText(item?.deviceType, 20) as DeviceType | null) ?? 'unknown',
      isBot: Boolean(item?.isBot),
      firstSeenAt: parseIsoOrNow(item?.firstSeenAt, fallbackIso),
      lastSeenAt: parseIsoOrNow(item?.lastSeenAt, fallbackIso),
      hits: parseHits(item?.hits)
    }))
    .filter((item) => Boolean(item.fingerprint));

  const paths = Array.isArray(history?.pagePaths) ? history.pagePaths : [];
  parsed.history.pagePaths = paths
    .map((item) => (isRecord(item) ? item : null))
    .filter(Boolean)
    .map((item) => ({
      path: normalizePagePath(cleanText(item?.path, 500)) ?? '',
      firstSeenAt: parseIsoOrNow(item?.firstSeenAt, fallbackIso),
      lastSeenAt: parseIsoOrNow(item?.lastSeenAt, fallbackIso),
      hits: parseHits(item?.hits)
    }))
    .filter((item) => Boolean(item.path));

  return parsed;
}

function upsertWithHits<T extends {firstSeenAt: string; lastSeenAt: string; hits: number}>(
  list: T[],
  find: (item: T) => boolean,
  build: () => T,
  patch?: (item: T) => T
): T[] {
  const index = list.findIndex(find);
  if (index < 0) {
    return [...list, build()];
  }
  return list.map((item, itemIndex) => {
    if (itemIndex !== index) {
      return item;
    }
    const next = patch ? patch(item) : item;
    return {
      ...next,
      hits: item.hits + 1
    };
  });
}

type CapsConfig = {
  ips?: number;
  countries?: number;
  userAgents?: number;
  pagePaths?: number;
};

export function pruneClientTelemetry(
  telemetry: ClientTelemetryV1,
  now = new Date(),
  ttlDays = DEFAULT_TTL_DAYS,
  caps: CapsConfig = {}
): ClientTelemetryV1 {
  const cutoffMs = now.getTime() - ttlDays * 24 * 60 * 60 * 1000;
  const isFresh = (iso: string) => Date.parse(iso) >= cutoffMs;
  const limit = (value: number | undefined) => Math.max(1, Math.min(DEFAULT_HISTORY_CAP, value ?? DEFAULT_HISTORY_CAP));

  return {
    ...telemetry,
    history: {
      ips: telemetry.history.ips
        .filter((row) => isFresh(row.lastSeenAt))
        .sort((a, b) => compareIsoDesc(a.lastSeenAt, b.lastSeenAt))
        .slice(0, limit(caps.ips)),
      countries: telemetry.history.countries
        .filter((row) => isFresh(row.lastSeenAt))
        .sort((a, b) => compareIsoDesc(a.lastSeenAt, b.lastSeenAt))
        .slice(0, limit(caps.countries)),
      userAgents: telemetry.history.userAgents
        .filter((row) => isFresh(row.lastSeenAt))
        .sort((a, b) => compareIsoDesc(a.lastSeenAt, b.lastSeenAt))
        .slice(0, limit(caps.userAgents)),
      pagePaths: telemetry.history.pagePaths
        .filter((row) => isFresh(row.lastSeenAt))
        .sort((a, b) => compareIsoDesc(a.lastSeenAt, b.lastSeenAt))
        .slice(0, limit(caps.pagePaths))
    }
  };
}

export function mergeClientTelemetry(
  previous: unknown,
  snapshot: ClientTelemetrySnapshot,
  eventType: ClientTelemetryEventType,
  now = new Date()
): ClientTelemetryV1 {
  const nowIso = now.toISOString();
  const existing = hydrateTelemetry(previous, nowIso);
  const base = existing ?? createInitialTelemetry(nowIso, snapshot, eventType);
  const uaFingerprint = userAgentFingerprint(snapshot);
  const merged: ClientTelemetryV1 = {
    ...base,
    firstSeenAt: existing ? base.firstSeenAt : nowIso,
    lastSeenAt: nowIso,
    stats: {
      sessionStarts: (existing ? base.stats.sessionStarts : 0) + (eventType === 'session_start' ? 1 : 0),
      messages: (existing ? base.stats.messages : 0) + (eventType === 'message' ? 1 : 0),
      lastEventType: eventType
    },
    latest: snapshot,
    history: {
      ips: [...base.history.ips],
      countries: [...base.history.countries],
      userAgents: [...base.history.userAgents],
      pagePaths: [...base.history.pagePaths]
    }
  };

  if (snapshot.ipHash) {
    merged.history.ips = upsertWithHits(
      merged.history.ips,
      (item) => item.ipHash === snapshot.ipHash,
      () => ({
        ipRaw: snapshot.ipRaw,
        ipMasked: snapshot.ipMasked,
        ipHash: snapshot.ipHash as string,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        hits: 1
      }),
      (item) => ({
        ...item,
        ipRaw: snapshot.ipRaw,
        ipMasked: snapshot.ipMasked,
        lastSeenAt: nowIso
      })
    );
  }

  if (snapshot.countryCode) {
    const countryKey = `${snapshot.countryCode}|${snapshot.countryRegion ?? ''}|${snapshot.city ?? ''}`;
    merged.history.countries = upsertWithHits(
      merged.history.countries,
      (item) => `${item.countryCode}|${item.region ?? ''}|${item.city ?? ''}` === countryKey,
      () => ({
        countryCode: snapshot.countryCode as string,
        region: snapshot.countryRegion,
        city: snapshot.city,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        hits: 1
      }),
      (item) => ({
        ...item,
        region: snapshot.countryRegion,
        city: snapshot.city,
        lastSeenAt: nowIso
      })
    );
  }

  if (uaFingerprint) {
    merged.history.userAgents = upsertWithHits(
      merged.history.userAgents,
      (item) => item.fingerprint === uaFingerprint,
      () => ({
        fingerprint: uaFingerprint,
        userAgentRaw: snapshot.userAgentRaw,
        browserFamily: snapshot.browserFamily,
        browserVersion: snapshot.browserVersion,
        osFamily: snapshot.osFamily,
        osVersion: snapshot.osVersion,
        deviceType: snapshot.deviceType,
        isBot: snapshot.isBot,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        hits: 1
      }),
      (item) => ({
        ...item,
        userAgentRaw: snapshot.userAgentRaw,
        browserFamily: snapshot.browserFamily,
        browserVersion: snapshot.browserVersion,
        osFamily: snapshot.osFamily,
        osVersion: snapshot.osVersion,
        deviceType: snapshot.deviceType,
        isBot: snapshot.isBot,
        lastSeenAt: nowIso
      })
    );
  }

  if (snapshot.pagePath) {
    merged.history.pagePaths = upsertWithHits(
      merged.history.pagePaths,
      (item) => item.path === snapshot.pagePath,
      () => ({
        path: snapshot.pagePath as string,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        hits: 1
      }),
      (item) => ({
        ...item,
        lastSeenAt: nowIso
      })
    );
  }

  return pruneClientTelemetry(merged, now);
}

export function readClientTelemetry(metadata: Record<string, unknown> | null | undefined): ClientTelemetryV1 | null {
  if (!metadata || !isRecord(metadata)) {
    return null;
  }
  const fallbackIso = new Date().toISOString();
  return hydrateTelemetry(metadata.clientTelemetry, fallbackIso);
}

function maybeEarlier(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return Date.parse(candidate) < Date.parse(current) ? candidate : current;
}

function maybeLater(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function compactRecent<T extends {lastSeenAt: string}>(items: T[], cap = 8): T[] {
  return [...items].sort((a, b) => compareIsoDesc(a.lastSeenAt, b.lastSeenAt)).slice(0, cap);
}

export function aggregateTechnicalSignals(
  conversations: Array<{metadata?: Record<string, unknown> | null}>
): TechnicalSignalsAggregate | null {
  const telemetryRows = conversations
    .map((conversation) => readClientTelemetry(conversation.metadata ?? null))
    .filter((item): item is ClientTelemetryV1 => Boolean(item));

  if (!telemetryRows.length) {
    return null;
  }

  let firstSeenAt: string | null = null;
  let lastSeenAt: string | null = null;
  let latestSnapshot: ClientTelemetrySnapshot | null = null;
  let latestSnapshotAt: string | null = null;

  const ipMap = new Map<string, {ipMasked: string | null; hits: number; lastSeenAt: string}>();
  const countryMap = new Map<string, {countryCode: string; region: string | null; city: string | null; hits: number; lastSeenAt: string}>();
  const agentMap = new Map<string, {
    browserFamily: BrowserFamily | null;
    browserVersion: string | null;
    osFamily: OsFamily | null;
    osVersion: string | null;
    deviceType: DeviceType;
    isBot: boolean;
    hits: number;
    lastSeenAt: string;
  }>();

  for (const telemetry of telemetryRows) {
    firstSeenAt = maybeEarlier(firstSeenAt, telemetry.firstSeenAt);
    lastSeenAt = maybeLater(lastSeenAt, telemetry.lastSeenAt);

    if (!latestSnapshotAt || Date.parse(telemetry.lastSeenAt) >= Date.parse(latestSnapshotAt)) {
      latestSnapshotAt = telemetry.lastSeenAt;
      latestSnapshot = telemetry.latest;
    }

    for (const ip of telemetry.history.ips) {
      const existing = ipMap.get(ip.ipHash);
      if (!existing) {
        ipMap.set(ip.ipHash, {
          ipMasked: ip.ipMasked,
          hits: ip.hits,
          lastSeenAt: ip.lastSeenAt
        });
        continue;
      }
      ipMap.set(ip.ipHash, {
        ipMasked: ip.ipMasked ?? existing.ipMasked,
        hits: existing.hits + ip.hits,
        lastSeenAt: Date.parse(ip.lastSeenAt) > Date.parse(existing.lastSeenAt) ? ip.lastSeenAt : existing.lastSeenAt
      });
    }

    for (const country of telemetry.history.countries) {
      const key = `${country.countryCode}|${country.region ?? ''}|${country.city ?? ''}`;
      const existing = countryMap.get(key);
      if (!existing) {
        countryMap.set(key, {
          countryCode: country.countryCode,
          region: country.region,
          city: country.city,
          hits: country.hits,
          lastSeenAt: country.lastSeenAt
        });
        continue;
      }
      countryMap.set(key, {
        ...existing,
        hits: existing.hits + country.hits,
        lastSeenAt: Date.parse(country.lastSeenAt) > Date.parse(existing.lastSeenAt) ? country.lastSeenAt : existing.lastSeenAt
      });
    }

    for (const agent of telemetry.history.userAgents) {
      const existing = agentMap.get(agent.fingerprint);
      if (!existing) {
        agentMap.set(agent.fingerprint, {
          browserFamily: agent.browserFamily,
          browserVersion: agent.browserVersion,
          osFamily: agent.osFamily,
          osVersion: agent.osVersion,
          deviceType: agent.deviceType,
          isBot: agent.isBot,
          hits: agent.hits,
          lastSeenAt: agent.lastSeenAt
        });
        continue;
      }
      agentMap.set(agent.fingerprint, {
        browserFamily: agent.browserFamily ?? existing.browserFamily,
        browserVersion: agent.browserVersion ?? existing.browserVersion,
        osFamily: agent.osFamily ?? existing.osFamily,
        osVersion: agent.osVersion ?? existing.osVersion,
        deviceType: agent.deviceType !== 'unknown' ? agent.deviceType : existing.deviceType,
        isBot: agent.isBot || existing.isBot,
        hits: existing.hits + agent.hits,
        lastSeenAt: Date.parse(agent.lastSeenAt) > Date.parse(existing.lastSeenAt) ? agent.lastSeenAt : existing.lastSeenAt
      });
    }
  }

  const recentIps = compactRecent(Array.from(ipMap.values()));
  const recentCountries = compactRecent(Array.from(countryMap.values()));
  const recentAgents = compactRecent(Array.from(agentMap.values()));
  const lastBrowser = latestSnapshot?.browserFamily
    ? [latestSnapshot.browserFamily, latestSnapshot.browserVersion].filter(Boolean).join(' ')
    : null;
  const lastCountry = latestSnapshot?.countryCode
    ? [latestSnapshot.countryCode, latestSnapshot.countryRegion, latestSnapshot.city].filter(Boolean).join(', ')
    : null;

  return {
    firstSeenAt,
    lastSeenAt,
    lastIpMasked: latestSnapshot?.ipMasked ?? null,
    lastCountry,
    lastBrowser,
    lastDeviceType: latestSnapshot?.deviceType ?? null,
    uniqueIpCount90d: ipMap.size,
    uniqueCountryCount90d: countryMap.size,
    uniqueDeviceCount90d: new Set(Array.from(agentMap.values()).map((item) => item.deviceType)).size,
    recentIps: recentIps.map((item) => ({
      ipMasked: item.ipMasked,
      hits: item.hits,
      lastSeenAt: item.lastSeenAt
    })),
    recentCountries: recentCountries.map((item) => ({
      countryCode: item.countryCode,
      region: item.region,
      city: item.city,
      hits: item.hits,
      lastSeenAt: item.lastSeenAt
    })),
    recentAgents: recentAgents.map((item) => ({
      browserFamily: item.browserFamily,
      browserVersion: item.browserVersion,
      osFamily: item.osFamily,
      osVersion: item.osVersion,
      deviceType: item.deviceType,
      isBot: item.isBot,
      hits: item.hits,
      lastSeenAt: item.lastSeenAt
    }))
  };
}
