import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {adminVerifyLinkSchema} from '@/lib/schemas';
import {verifyConversationLink} from '@/lib/repositories/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

export async function POST(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const payload = adminVerifyLinkSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  const {id} = await context.params;
  const result = await verifyConversationLink({
    conversationId: id,
    action: payload.data.action,
    actorRole: admin.role,
    actorType: 'manager',
    actorUserId: admin.userId,
    targetCustomerId: payload.data.targetCustomerId,
    note: payload.data.note
  });

  return NextResponse.json({ok: true, data: result});
}
