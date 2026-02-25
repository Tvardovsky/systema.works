function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEnvValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getSupabaseUrl(): string {
  // Use direct property access so Next can inline NEXT_PUBLIC_* vars in client bundles.
  const url = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }

  const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUPABASE_URL. Expected full URL like https://<project-ref>.supabase.co, got "${url}".`
    );
  }

  return normalized;
}

export function getSupabasePublishableKey(): string {
  // Use direct property access so Next can inline NEXT_PUBLIC_* vars in client bundles.
  const publishable = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (publishable) {
    return publishable;
  }
  const legacyAnon = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (legacyAnon) {
    return legacyAnon;
  }
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)');
}

export function getSupabaseSecretKey(): string {
  const secret = readEnv('SUPABASE_SECRET_KEY');
  if (secret) {
    return secret;
  }
  const legacyServiceRole = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyServiceRole) {
    return legacyServiceRole;
  }
  throw new Error('Missing SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)');
}
