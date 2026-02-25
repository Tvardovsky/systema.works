import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {adminBulkReadSchema} from '@/lib/schemas';
import {markConversationsReadBulk} from '@/lib/repositories/omnichannel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }
  if (!UUID_RE.test(admin.userId)) {
    return NextResponse.json({error: 'Read receipts require Supabase session auth'}, {status: 400});
  }

  const payload = adminBulkReadSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  const data = await markConversationsReadBulk({
    conversationIds: payload.data.conversationIds,
    adminUserId: admin.userId
  });

  return NextResponse.json({ok: true, data});
}
