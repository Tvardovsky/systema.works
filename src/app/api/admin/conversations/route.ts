import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {listConversations} from '@/lib/repositories/omnichannel';
import type {Channel, ConversationStatus} from '@/types/omnichannel';

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  const status = request.nextUrl.searchParams.get('status') as ConversationStatus | null;
  const channel = request.nextUrl.searchParams.get('channel') as Channel | null;

  const data = await listConversations({
    status: status ?? undefined,
    channel: channel ?? undefined,
    limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100
  });

  return NextResponse.json({ok: true, data});
}

