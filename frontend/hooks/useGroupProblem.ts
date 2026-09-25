'use client';

import { useSyncExternalStore } from 'react';
import { useSyncEngine } from './useSyncEngine';
import type { GroupProblem } from '../lib/mls/sync/groupProblems';
import type { ConversationId } from '../lib/mls/contract/types';

const noUnsubscribe = () => undefined;
const subscribeNothing = () => noUnsubscribe;
const noProblem = () => undefined;

/** The group problem this device has recorded for a conversation, if any (a refused commit, or state it cannot read or rebuild). */
export function useGroupProblem(conversationId: ConversationId): GroupProblem | undefined {
  const tracker = useSyncEngine()?.groupProblems;
  return useSyncExternalStore(
    tracker?.subscribe ?? subscribeNothing,
    tracker && conversationId ? () => tracker.get(conversationId) : noProblem,
    noProblem,
  );
}
