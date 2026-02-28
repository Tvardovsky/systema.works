import {NextRequest, NextResponse} from 'next/server';
import {requireAdminRequest} from '@/lib/admin';
import {getConversationMessages, getLeadBriefByConversation, getConversationById} from '@/lib/repositories/omnichannel';
import {extractBriefFromConversation} from '@/lib/conversation/brief-extractor';
import {computeLeadBriefState} from '@/lib/lead-brief';
import {upsertLeadBrief, appendLeadBriefRevision} from '@/lib/repositories/omnichannel';

type Params = {
  params: Promise<{id: string}>;
};

export async function POST(request: NextRequest, context: Params) {
  const admin = await requireAdminRequest(request);
  if (!admin || (admin.role !== 'owner' && admin.role !== 'manager')) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }

  const {id: conversationId} = await context.params;

  // Verify conversation exists
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return NextResponse.json({error: 'Conversation not found'}, {status: 404});
  }

  try {
    // Get conversation messages for extraction
    const messages = await getConversationMessages(conversationId, 100);
    const history = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }));

    if (history.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No messages to extract from'
      }, {status: 400});
    }

    // Get existing brief for merging
    const existingBrief = await getLeadBriefByConversation(conversationId);

    // Run extraction
    const extractionResult = await extractBriefFromConversation({
      locale: (conversation.locale as any) ?? 'ru',
      message: history[history.length - 1]?.content ?? '',
      history,
      conversationId,
      currentTurn: history.length,
      existingBrief: existingBrief ? {
        fullName: existingBrief.fullName,
        email: existingBrief.email,
        phone: existingBrief.phone,
        telegramHandle: existingBrief.telegramHandle,
        serviceType: existingBrief.serviceType,
        primaryGoal: existingBrief.primaryGoal,
        firstDeliverable: existingBrief.firstDeliverable,
        timelineHint: existingBrief.timelineHint,
        budgetHint: existingBrief.budgetHint,
        referralSource: existingBrief.referralSource,
        constraints: existingBrief.constraints,
        fieldConfidence: {},
        fieldSource: {},
        managerVerifiedFields: [],
        lastExtractionTurn: 0,
        lastExtractionAt: existingBrief.updatedAt,
        totalExtractions: 0
      } : null
    });

    // Calculate brief state
    const mergedBrief = extractionResult.mergedBrief;
    const briefState = computeLeadBriefState({
      fullName: mergedBrief.fullName,
      email: mergedBrief.email,
      phone: mergedBrief.phone,
      telegramHandle: mergedBrief.telegramHandle,
      serviceType: mergedBrief.serviceType,
      primaryGoal: mergedBrief.primaryGoal,
      firstDeliverable: mergedBrief.firstDeliverable,
      timelineHint: mergedBrief.timelineHint,
      budgetHint: mergedBrief.budgetHint,
      referralSource: mergedBrief.referralSource,
      constraints: mergedBrief.constraints
    }, {highIntent: false});

    // Upsert brief to database
    const patchData: any = {
      fullName: mergedBrief.fullName,
      email: mergedBrief.email,
      phone: mergedBrief.phone,
      telegramHandle: mergedBrief.telegramHandle,
      serviceType: mergedBrief.serviceType,
      primaryGoal: mergedBrief.primaryGoal,
      firstDeliverable: mergedBrief.firstDeliverable,
      timelineHint: mergedBrief.timelineHint,
      budgetHint: mergedBrief.budgetHint,
      referralSource: mergedBrief.referralSource,
      constraints: mergedBrief.constraints,
      briefStructured: {
        fieldConfidence: mergedBrief.fieldConfidence,
        fieldSource: mergedBrief.fieldSource,
        lastExtractionTurn: mergedBrief.lastExtractionTurn,
        totalExtractions: mergedBrief.totalExtractions,
        manuallyExtracted: true,
        extractedAt: new Date().toISOString()
      },
      briefStructuredVersion: 'conversational'
    };
    
    const updatedBrief = await upsertLeadBrief({
      conversationId,
      customerId: conversation.customer_id,
      sourceChannel: conversation.channel,
      updatedBy: 'manager',
      status: briefState.status,
      missingFields: briefState.missingFields,
      completenessScore: briefState.completenessScore,
      patch: patchData
    });

    // Log revision
    await appendLeadBriefRevision({
      leadBriefId: updatedBrief.id,
      changedByType: 'manager',
      changedByUserId: admin.userId,
      beforeState: existingBrief ? {brief: existingBrief} : {},
      afterState: {brief: updatedBrief},
      note: 'Manual brief extraction from admin dashboard'
    });

    return NextResponse.json({
      ok: true,
      data: {
        brief: updatedBrief,
        extraction: {
          completenessScore: extractionResult.completeness.score,
          readyForHandoff: extractionResult.completeness.readyForHandoff,
          fieldsUpdated: Object.entries(mergedBrief)
            .filter(([key, value]) => 
              value !== null && 
              !['fieldConfidence', 'fieldSource', 'managerVerifiedFields', 'lastExtractionTurn', 'lastExtractionAt', 'totalExtractions'].includes(key)
            )
            .map(([key]) => key),
          llmCallsCount: extractionResult.llmCallsCount,
          modelUsed: extractionResult.modelUsed
        }
      }
    });
  } catch (error) {
    console.error('[admin/brief/extract] Error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Extraction failed'
    }, {status: 500});
  }
}
