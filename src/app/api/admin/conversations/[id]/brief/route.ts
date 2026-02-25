import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {adminBriefPatchSchema} from '@/lib/schemas';
import {computeLeadBriefState} from '@/lib/lead-brief';
import {
  appendLeadBriefRevision,
  captureIdentityClaims,
  getConversationById,
  getLeadBriefBundle,
  getLeadBriefByConversation,
  touchCustomerContacts,
  touchIdentityContacts,
  upsertLeadBrief
} from '@/lib/repositories/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

export async function GET(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const data = await getLeadBriefBundle(id);
  return NextResponse.json({ok: true, data});
}

export async function PATCH(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id} = await context.params;
  const payload = adminBriefPatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  const conversation = await getConversationById(id);
  if (!conversation) {
    return NextResponse.json({error: 'Conversation not found'}, {status: 404});
  }

  const current = await getLeadBriefByConversation(id);
  const merged = {
    fullName: payload.data.fullName ?? current?.fullName ?? null,
    email: payload.data.email ?? current?.email ?? null,
    phone: payload.data.phone ?? current?.phone ?? null,
    telegramHandle: payload.data.telegramHandle ?? current?.telegramHandle ?? null,
    serviceType: payload.data.serviceType ?? current?.serviceType ?? null,
    primaryGoal: payload.data.primaryGoal ?? current?.primaryGoal ?? null,
    firstDeliverable: payload.data.firstDeliverable ?? current?.firstDeliverable ?? null,
    timelineHint: payload.data.timelineHint ?? current?.timelineHint ?? null,
    budgetHint: payload.data.budgetHint ?? current?.budgetHint ?? null,
    referralSource: payload.data.referralSource ?? current?.referralSource ?? null,
    constraints: payload.data.constraints ?? current?.constraints ?? null
  };

  const computed = computeLeadBriefState(merged, {highIntent: false});
  const updated = await upsertLeadBrief({
    conversationId: id,
    customerId: conversation.customer_id,
    sourceChannel: conversation.channel,
    updatedBy: 'manager',
    status: computed.status,
    missingFields: computed.missingFields,
    completenessScore: computed.completenessScore,
    patch: merged
  });

  await appendLeadBriefRevision({
    leadBriefId: updated.id,
    changedByType: 'manager',
    changedByUserId: admin.userId,
    beforeState: current ? {brief: current} : {},
    afterState: {brief: updated},
    note: payload.data.note
  });

  await touchCustomerContacts({
    customerId: conversation.customer_id,
    fullName: merged.fullName ?? undefined,
    email: merged.email ?? undefined,
    phone: merged.phone ?? undefined
  });

  if (conversation.channel_user_id) {
    await touchIdentityContacts({
      customerId: conversation.customer_id,
      channel: conversation.channel,
      channelUserId: conversation.channel_user_id,
      email: merged.email ?? undefined,
      phone: merged.phone ?? undefined,
      telegramHandle: merged.telegramHandle ?? undefined
    });
  }
  await captureIdentityClaims({
    conversationId: id,
    customerId: conversation.customer_id,
    sourceChannel: conversation.channel,
    email: merged.email,
    phone: merged.phone,
    telegramHandle: merged.telegramHandle,
    status: conversation.identity_state === 'verified'
      ? 'verified'
      : (conversation.pending_customer_id ? 'candidate_match' : 'captured'),
    matchedCustomerId: conversation.pending_customer_id ?? null
  });

  const data = await getLeadBriefBundle(id);
  return NextResponse.json({ok: true, data});
}
