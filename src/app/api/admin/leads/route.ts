import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {adminLeadsPipelineQuerySchema} from '@/lib/schemas';
import {listLeadEvents, listLeadOutcomes, listLeadPipeline} from '@/lib/repositories/omnichannel';
import type {
  ConversationStatus,
  LeadEventType,
  LeadPipelineMissingSlotFilter,
  LeadPipelineNextSlotFilter,
  LeadPipelineReadinessFilter,
  LeadPriority
} from '@/types/omnichannel';

export async function GET(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const view = request.nextUrl.searchParams.get('view');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '100');
  if (view === 'pipeline') {
    const parsedFilters = adminLeadsPipelineQuerySchema.safeParse({
      status: request.nextUrl.searchParams.get('status') ?? undefined,
      assignee: request.nextUrl.searchParams.get('assignee') ?? undefined,
      q: request.nextUrl.searchParams.get('q') ?? undefined,
      readFilter: request.nextUrl.searchParams.get('readFilter') ?? undefined,
      sort: request.nextUrl.searchParams.get('sort') ?? undefined,
      readiness: request.nextUrl.searchParams.get('readiness') ?? undefined,
      missingSlot: request.nextUrl.searchParams.get('missingSlot') ?? undefined,
      nextSlot: request.nextUrl.searchParams.get('nextSlot') ?? undefined
    });
    const filters = parsedFilters.success ? parsedFilters.data : {};
    const readFilter = filters.readFilter ?? 'all';
    const sort = filters.sort ?? 'unread_first';
    const data = await listLeadPipeline({
      status: (filters.status as ConversationStatus | undefined) ?? undefined,
      assignee: filters.assignee ?? undefined,
      q: filters.q ?? undefined,
      limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100,
      viewerUserId: admin.userId,
      readFilter,
      sort,
      readiness: (filters.readiness as LeadPipelineReadinessFilter | undefined) ?? undefined,
      missingSlot: (filters.missingSlot as LeadPipelineMissingSlotFilter | undefined) ?? undefined,
      nextSlot: (filters.nextSlot as LeadPipelineNextSlotFilter | undefined) ?? undefined
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
