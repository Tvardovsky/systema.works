import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {listProjects} from '@/lib/repositories/omnichannel';
import type {ProjectStatus} from '@/types/omnichannel';

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  const accountId = request.nextUrl.searchParams.get('accountId') ?? undefined;
  const status = request.nextUrl.searchParams.get('status') as ProjectStatus | null;

  const data = await listProjects({
    accountId,
    status: status ?? undefined,
    limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100
  });

  return NextResponse.json({ok: true, data});
}

