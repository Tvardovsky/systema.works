import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {listDeadLetters, updateDeadLetter} from '@/lib/repositories/omnichannel';

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  const resolvedParam = request.nextUrl.searchParams.get('resolved');
  const resolved = resolvedParam === null ? undefined : resolvedParam === 'true';

  const data = await listDeadLetters({
    resolved,
    limit: Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 100
  });
  return NextResponse.json({ok: true, data});
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const payload = (await request.json().catch(() => ({}))) as {id?: string; resolved?: boolean};
  if (!payload.id || typeof payload.resolved !== 'boolean') {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  await updateDeadLetter({id: payload.id, resolved: payload.resolved});
  return NextResponse.json({ok: true});
}

