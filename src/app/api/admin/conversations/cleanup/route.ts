import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {requireAdminRequest} from '@/lib/admin';
import {cleanupUnknownAndOpenWebConversations} from '@/lib/repositories/omnichannel';

const payloadSchema = z.object({
  confirmed: z.literal(true),
  mode: z.enum(['close', 'delete']).optional().default('close')
});

export async function POST(request: NextRequest) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const payload = payloadSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }
  if (payload.data.mode === 'delete' && admin.role !== 'owner') {
    return NextResponse.json({error: 'Only owner can delete conversations'}, {status: 403});
  }

  const data = await cleanupUnknownAndOpenWebConversations({
    mode: payload.data.mode,
    performedByUserId: admin.userId,
    performedByRole: admin.role
  });

  return NextResponse.json({ok: true, data});
}
