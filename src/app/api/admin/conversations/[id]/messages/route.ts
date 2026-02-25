import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {listConversationMessages} from '@/lib/repositories/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

type AdminMessageMetadata = {
  engineVersion: string | null;
  dialogNextSlot: string | null;
  dialogMode: string | null;
  safetyReason: string | null;
  chatMode: string | null;
  dialogTurnMode: string | null;
  questionsCount: number | null;
  fallbackPath: string | null;
  validatorAdjusted: boolean | null;
};

function toAdminMessageMetadata(input: unknown): AdminMessageMetadata {
  const metadata = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
  const pick = (key: string): string | null => {
    const value = metadata?.[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const pickNumber = (key: string): number | null => {
    const value = metadata?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const pickBoolean = (key: string): boolean | null => {
    const value = metadata?.[key];
    return typeof value === 'boolean' ? value : null;
  };

  return {
    engineVersion: pick('engineVersion'),
    dialogNextSlot: pick('dialogNextSlot'),
    dialogMode: pick('dialogMode'),
    safetyReason: pick('safetyReason'),
    chatMode: pick('chatMode'),
    dialogTurnMode: pick('dialogTurnMode'),
    questionsCount: pickNumber('questionsCount'),
    fallbackPath: pick('fallbackPath'),
    validatorAdjusted: pickBoolean('validatorAdjusted')
  };
}

export async function GET(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '150');
  const rows = await listConversationMessages(id, Number.isFinite(limit) ? Math.min(limit, 500) : 150);
  const data = rows.map((row) => ({
    ...row,
    metadata: toAdminMessageMetadata(row.metadata)
  }));
  return NextResponse.json({ok: true, data});
}
