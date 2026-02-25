import {NextRequest} from 'next/server';
import {getSupabaseAdminClient} from '@/lib/supabase/admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {getAdminRoleForUser} from '@/lib/repositories/omnichannel';

export type AdminAuthContext = {
  userId: string;
  role: 'owner' | 'manager' | 'viewer';
};

function getLegacyAdminToken(request: NextRequest): string {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const queryToken = request.nextUrl.searchParams.get('token') ?? '';
  return bearer || queryToken;
}

async function getAuthedUserId(request: NextRequest): Promise<string | null> {
  const serverClient = await getSupabaseServerClient();
  const sessionResult = await serverClient.auth.getUser();
  if (sessionResult.data.user?.id) {
    return sessionResult.data.user.id;
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) {
    return null;
  }

  const adminClient = getSupabaseAdminClient();
  const tokenResult = await adminClient.auth.getUser(token);
  return tokenResult.data.user?.id ?? null;
}

export async function requireAdminRequest(request: NextRequest): Promise<AdminAuthContext | null> {
  const legacyExpected = process.env.ADMIN_DASH_TOKEN;
  const legacyProvided = getLegacyAdminToken(request);
  if (legacyExpected && legacyProvided && legacyExpected === legacyProvided) {
    return {userId: 'legacy-admin-token', role: 'owner'};
  }

  const userId = await getAuthedUserId(request);
  if (!userId) {
    return null;
  }

  const role = await getAdminRoleForUser(userId);
  if (!role) {
    return null;
  }

  return {userId, role};
}
