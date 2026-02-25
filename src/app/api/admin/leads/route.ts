import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {listLeadEvents, listLeadOutcomes, listLeadPipeline} from '@/lib/repositories/omnichannel';
import type {ConversationStatus, LeadEventType, LeadPriority} from '@/types/omnichannel';

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const view = request.nextUrl.searchParams.get('view');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  if (view === 'pipeline') {
    const status = request.nextUrl.searchParams.get('status') as ConversationStatus | null;
    const assignee = request.nextUrl.searchParams.get('assignee');
    const q = request.nextUrl.searchParams.get('q');
    const readFilterRaw = request.nextUrl.searchParams.get('readFilter');
    const readFilter = readFilterRaw === 'personal_unread' || readFilterRaw === 'personal_read' || readFilterRaw === 'all'
      ? readFilterRaw
      : 'all';
    const sortRaw = request.nextUrl.searchParams.get('sort');
    const sort = sortRaw === 'updated_desc' || sortRaw === 'unread_first' ? sortRaw : 'unread_first';
    const data = await listLeadPipeline({
      status: status ?? undefined,
      assignee: assignee ?? undefined,
      q: q ?? undefined,
      limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100,
      viewerUserId: admin.userId,
      readFilter,
      sort
    });
    return NextResponse.json({ok: true, data});
  }

  if (view === 'outcomes') {
    const outcomeRaw = request.nextUrl.searchParams.get('outcome');
    const outcome = outcomeRaw === 'won' || outcomeRaw === 'lost' ? outcomeRaw : undefined;
    const q = request.nextUrl.searchParams.get('q');
    const data = await listLeadOutcomes({
      outcome,
      q: q ?? undefined,
      limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100
    });
    return NextResponse.json({ok: true, data});
  }

  const priority = request.nextUrl.searchParams.get('priority') as LeadPriority | null;
  const status = request.nextUrl.searchParams.get('status') as LeadEventType | null;
  const data = await listLeadEvents({
    priority: priority ?? undefined,
    status: status ?? undefined,
    limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100
  });

  return NextResponse.json({ok: true, data});
}
