import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {requireAdminRequest} from '@/lib/admin';
import {setConversationOutcome} from '@/lib/repositories/omnichannel';

const payloadSchema = z.object({
  outcome: z.enum(['won', 'lost']),
  note: z.string().max(500).optional(),
  intentScore: z.number().int().min(0).max(100).optional()
});

type Params = {
  params: Promise<{id: string}>;
};

export async function POST(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const payload = payloadSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  const {id} = await context.params;
  await setConversationOutcome({
    conversationId: id,
    managerUserId: admin.userId,
    outcome: payload.data.outcome,
    note: payload.data.note,
    intentScore: payload.data.intentScore
  });

  return NextResponse.json({ok: true});
}
