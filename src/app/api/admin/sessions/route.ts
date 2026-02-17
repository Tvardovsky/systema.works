import {NextRequest, NextResponse} from 'next/server';
import {isAdminRequest} from '@/lib/admin';
import {getSessionLogs} from '@/lib/logs';

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  const data = await getSessionLogs(Number.isFinite(limit) ? Math.min(limit, 500) : 100);
  return NextResponse.json({ok: true, data});
}
