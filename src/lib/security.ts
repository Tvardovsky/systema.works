import type {NextRequest} from 'next/server';

type RateRecord = {count: number; resetAt: number};

const rateMap = new Map<string, RateRecord>();

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateMap.get(key);

  if (!record || now > record.resetAt) {
    rateMap.set(key, {count: 1, resetAt: now + windowMs});
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count += 1;
  return true;
}

export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const enforceInDev = process.env.TURNSTILE_ENFORCE_DEV === 'true';
  if (process.env.NODE_ENV !== 'production' && !enforceInDev) {
    return true;
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }

  if (!token) {
    return false;
  }

  const payload = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip
  });

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: payload
  });

  if (!response.ok) {
    return false;
  }

  const data = (await response.json()) as {success?: boolean};
  return Boolean(data.success);
}
