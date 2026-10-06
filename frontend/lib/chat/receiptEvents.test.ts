import { describe, expect, it } from 'vitest';
import type { ReceiptLike } from './messageStatus';
import { applyReceiptsEvent, type ReceiptsEvent } from './receiptEvents';

const AT = '2026-10-06T10:05:00.000Z';

type Cached = { id: string; senderId: string; receipts?: ReceiptLike[] };

const message = (id: string, senderId: string, receipts: ReceiptLike[] = []): Cached => ({
  id,
  senderId,
  receipts,
});

describe('applyReceiptsEvent', () => {
  describe('delivered', () => {
    const event: ReceiptsEvent = { kind: 'delivered', conversationId: 'c1', userId: 'bob', messageIds: ['m1', 'm3'] };

    it('marks the named messages delivered to that person, and no others', () => {
      const result = applyReceiptsEvent([message('m1', 'me'), message('m2', 'me'), message('m3', 'me')], event);

      expect(result?.[0]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: null }]);
      expect(result?.[1]?.receipts).toEqual([]);
      expect(result?.[2]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: null }]);
    });

    it('keeps a read that is already there', () => {
      const result = applyReceiptsEvent([message('m1', 'me', [{ userId: 'bob', delivered: true, readAt: AT }])], event);

      expect(result?.[0]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: AT }]);
    });

    it('replaces the same person without touching other people', () => {
      const result = applyReceiptsEvent(
        [message('m1', 'me', [{ userId: 'ann', delivered: true }, { userId: 'bob', delivered: false }])],
        event,
      );

      expect(result?.[0]?.receipts).toEqual([
        { userId: 'ann', delivered: true },
        { userId: 'bob', delivered: true, readAt: null },
      ]);
    });

    it('takes over from the shape a fresh send returns', () => {
      const result = applyReceiptsEvent([message('m1', 'me', [{ userId: 'bob', deliveredAt: null, readAt: null }])], event);

      expect(result?.[0]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: null }]);
    });

    it('copes with messages that arrived over the socket with no receipts yet', () => {
      const fresh: Cached = { id: 'm1', senderId: 'me' };

      const result = applyReceiptsEvent([fresh], event);

      expect(result?.[0]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: null }]);
    });

    it('does nothing for ids that are not in the list', () => {
      const result = applyReceiptsEvent([message('m9', 'me')], event);

      expect(result?.[0]?.receipts).toEqual([]);
    });
  });

  describe('read', () => {
    const event: ReceiptsEvent = { kind: 'read', conversationId: 'c1', userId: 'bob', upToMessageId: 'm2', at: AT };

    it('marks everything up to that message read by that person, with the time', () => {
      const result = applyReceiptsEvent([message('m1', 'me'), message('m2', 'me'), message('m3', 'me')], event);

      expect(result?.[0]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: AT }]);
      expect(result?.[1]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: AT }]);
      expect(result?.[2]?.receipts).toEqual([]);
    });

    it("leaves the reader's own messages alone", () => {
      const result = applyReceiptsEvent([message('m1', 'bob'), message('m2', 'me')], event);

      expect(result?.[0]?.receipts).toEqual([]);
      expect(result?.[1]?.receipts).toEqual([{ userId: 'bob', delivered: true, readAt: AT }]);
    });

    it('asks the caller to fetch fresh when the message is not in the list', () => {
      expect(applyReceiptsEvent([message('m1', 'me')], event)).toBeNull();
    });

    it('does not change the list it was given', () => {
      const original = [message('m1', 'me'), message('m2', 'me')];

      applyReceiptsEvent(original, event);

      expect(original[0]?.receipts).toEqual([]);
    });
  });
});
