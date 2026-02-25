import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {adminHandoffSchema} from '@/lib/schemas';
import {handoffConversation} from '@/lib/repositories/omnichannel';
import {sendManagerAlert} from '@/lib/telegram';

type Params = {
  params: Promise<{id: string}>;
};

export async function POST(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const payload = adminHandoffSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  await handoffConversation({
    conversationId: id,
    managerUserId: admin.userId,
    note: payload.data.note,
    intentScore: payload.data.intentScore,
    mode: payload.data.mode,
    missingFieldsAtHandoff: payload.data.missingFieldsAtHandoff
  });

  await sendManagerAlert(
    `Manual handoff\nConversation: ${id}\nManager: ${admin.userId}\nMode: ${payload.data.mode}\nNote: ${payload.data.note ?? '-'}`
  );

  return NextResponse.json({ok: true, mode: payload.data.mode});
}
