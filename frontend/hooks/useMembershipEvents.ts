'use client';

import { useEffect, useState } from 'react';
import { membershipEventLog } from '../lib/mls/sync/sharedMembershipEventLog';
import type { MembershipEvent } from '../lib/mls/sync/membershipEvents';
import type { ConversationId } from '../lib/mls/contract/types';

const NO_EVENTS: MembershipEvent[] = [];

/** The membership changes this device verified in a conversation, live as new ones are recorded. */
export function useMembershipEvents(conversationId: ConversationId): MembershipEvent[] {
  const [loaded, setLoaded] = useState<{ id: ConversationId; events: MembershipEvent[] }>();

  useEffect(() => {
    if (!conversationId) return undefined;
    let cancelled = false;
    const load = () =>
      void membershipEventLog
        .list(conversationId)
        .then((events) => !cancelled && setLoaded({ id: conversationId, events }))
        .catch((error: unknown) => console.warn('Could not load membership notices', error));

    load();
    const unsubscribe = membershipEventLog.subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId]);

  return loaded?.id === conversationId ? loaded.events : NO_EVENTS;
}
