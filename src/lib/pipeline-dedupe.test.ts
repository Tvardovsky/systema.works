import {describe, expect, it} from 'bun:test';
import {dedupeLeadPipelineItems} from './pipeline-dedupe';

function makeItem(params: {
  id: string;
  customerId: string;
  status?: 'open' | 'qualified' | 'hot' | 'handoff' | 'closed';
  channel?: string;
  createdAt: string;
  updatedAt: string;
  leadIntentScore?: number;
  lastInboundMessageAt?: string | null;
  hasLatestEvent?: boolean;
  briefServiceType?: string | null;
  unread?: boolean;
}) {
  return {
    conversation: {
      id: params.id,
      customerId: params.customerId,
      channel: params.channel ?? 'web',
      status: params.status ?? 'open',
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      leadIntentScore: params.leadIntentScore ?? 0,
      lastInboundMessageAt: params.lastInboundMessageAt ?? null,
      personalUnread: Boolean(params.unread),
      globalUnread: Boolean(params.unread),
      isNewForAdmin: Boolean(params.unread),
      personalLastReadAt: null,
      globalLastReadAt: null
    },
    brief: params.briefServiceType ? {serviceType: params.briefServiceType} : null,
    latestEvent: params.hasLatestEvent ? {id: `ev-${params.id}`} : null
  };
}

describe('dedupeLeadPipelineItems', () => {
  it('collapses technical web duplicates by browser key regardless of time gap', () => {
    const items = [
      makeItem({
        id: 'newer',
        customerId: 'cust-1',
        createdAt: '2026-02-25T10:37:50.900Z',
        updatedAt: '2026-02-25T10:37:51.000Z'
      }),
      makeItem({
        id: 'older',
        customerId: 'cust-1',
        createdAt: '2026-02-25T11:52:50.100Z',
        updatedAt: '2026-02-25T10:37:11.000Z',
        unread: true
      })
    ];

    const deduped = dedupeLeadPipelineItems(items, {
      browserKeyByConversationId: new Map([
        ['newer', 'browser-key-1'],
        ['older', 'browser-key-1']
      ])
    });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.conversation.id).toBe('newer');
    expect(deduped[0]?.conversation.personalUnread).toBe(true);
  });

  it('does not dedupe technical items when browser key is missing', () => {
    const items = [
      makeItem({
        id: 'no-key-a',
        customerId: 'cust-4',
        createdAt: '2026-02-25T10:37:50.900Z',
        updatedAt: '2026-02-25T10:37:51.000Z'
      }),
      makeItem({
        id: 'no-key-b',
        customerId: 'cust-4',
        createdAt: '2026-02-25T12:11:50.100Z',
        updatedAt: '2026-02-25T10:37:11.000Z'
      })
    ];

    const deduped = dedupeLeadPipelineItems(items);
    expect(deduped).toHaveLength(2);
  });

  it('does not dedupe conversations with inbound messages', () => {
    const items = [
      makeItem({
        id: 'conv-a',
        customerId: 'cust-2',
        createdAt: '2026-02-25T10:37:10.000Z',
        updatedAt: '2026-02-25T10:37:11.000Z',
        lastInboundMessageAt: '2026-02-25T10:37:11.000Z'
      }),
      makeItem({
        id: 'conv-b',
        customerId: 'cust-2',
        createdAt: '2026-02-25T10:37:20.000Z',
        updatedAt: '2026-02-25T10:37:21.000Z'
      })
    ];

    const deduped = dedupeLeadPipelineItems(items);
    expect(deduped).toHaveLength(2);
  });

  it('does not dedupe non-technical lead with technical item on the same browser key', () => {
    const items = [
      makeItem({
        id: 'non-tech',
        customerId: 'cust-3',
        createdAt: '2026-02-25T10:37:10.000Z',
        updatedAt: '2026-02-25T10:37:11.000Z',
        briefServiceType: 'Landing page'
      }),
      makeItem({
        id: 'technical',
        customerId: 'cust-3',
        createdAt: '2026-02-25T10:37:20.000Z',
        updatedAt: '2026-02-25T10:37:21.000Z'
      })
    ];

    const deduped = dedupeLeadPipelineItems(items, {
      browserKeyByConversationId: new Map([
        ['non-tech', 'browser-key-2'],
        ['technical', 'browser-key-2']
      ])
    });
    expect(deduped).toHaveLength(2);
  });

  it('keeps newest item payload when technical duplicates are collapsed', () => {
    const items = [
      {
        ...makeItem({
          id: 'newest-dialog',
          customerId: 'cust-7',
          createdAt: '2026-02-25T10:37:50.900Z',
          updatedAt: '2026-02-25T11:37:51.000Z'
        }),
        dialog: {readiness: 'ready'}
      },
      {
        ...makeItem({
          id: 'older-dialog',
          customerId: 'cust-7',
          createdAt: '2026-02-25T10:00:50.900Z',
          updatedAt: '2026-02-25T10:37:11.000Z',
          unread: true
        }),
        dialog: {readiness: 'not_ready'}
      }
    ];

    const deduped = dedupeLeadPipelineItems(items, {
      browserKeyByConversationId: new Map([
        ['newest-dialog', 'browser-key-7'],
        ['older-dialog', 'browser-key-7']
      ])
    });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.conversation.id).toBe('newest-dialog');
    expect((deduped[0] as {dialog?: {readiness?: string}}).dialog?.readiness).toBe('ready');
    expect(deduped[0]?.conversation.personalUnread).toBe(true);
  });
});
