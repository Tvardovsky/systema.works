import {NextRequest} from 'next/server';

export function isAdminRequest(request: NextRequest): boolean {
  const expected = process.env.ADMIN_DASH_TOKEN;
  if (!expected) {
    return false;
  }

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const queryToken = request.nextUrl.searchParams.get('token') ?? '';

  return bearer === expected || queryToken === expected;
}
