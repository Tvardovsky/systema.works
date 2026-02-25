import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {listConversationMessages} from '@/lib/repositories/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

export async function GET(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '150');
  const data = await listConversationMessages(id, Number.isFinite(limit) ? Math.min(limit, 500) : 150);
  return NextResponse.json({ok: true, data});
}

