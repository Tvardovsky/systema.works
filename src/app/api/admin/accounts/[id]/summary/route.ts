import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {getAccountSummary} from '@/lib/repositories/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

export async function GET(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const data = await getAccountSummary(id);
  return NextResponse.json({ok: true, data});
}

