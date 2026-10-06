import { activeMembers, conversationDisplayName, conversationPeer } from './chatDisplay';
import type { SearchHit } from './messageSearchIndex';
import { foldForSearch, matchesAllTerms } from './searchFolding';

interface PersonLike {
  name?: string | null;
  username?: string | null;
}

interface ConversationLike {
  id: string;
  type?: string;
  participants?: { userId: string; state?: string; user?: PersonLike }[];
}

/** Everything a conversation can be found by: its name, and the name and @handle of each person in it. */
function searchableLabels(conversation: ConversationLike, userId: string | undefined): string {
  const others: (PersonLike | undefined)[] =
    conversation.type === 'GROUP'
      ? activeMembers(conversation)
          .filter((participant: { userId: string }) => participant.userId !== userId)
          .map((participant: { user?: PersonLike }) => participant.user)
      : [conversationPeer(conversation, userId)];

  const labels = [conversationDisplayName(conversation, userId)];
  for (const person of others) {
    if (person?.name) labels.push(person.name);
    if (person?.username) labels.push(person.username, `@${person.username}`);
  }
  return foldForSearch(labels.join(' '));
}

/** Whether the conversation's name, or anyone's name or @handle in it, contains every search term. */
export function conversationMatches(
  conversation: ConversationLike,
  userId: string | undefined,
  terms: string[],
): boolean {
  return matchesAllTerms(searchableLabels(conversation, userId), terms);
}

export interface ConversationHits<Conversation extends ConversationLike> {
  conversation: Conversation;
  hits: SearchHit[];
}

/** The hits per conversation, in the order the conversations are listed; conversations without a hit are left out. */
export function groupHitsByConversation<Conversation extends ConversationLike>(
  hits: SearchHit[],
  conversations: Conversation[],
): ConversationHits<Conversation>[] {
  const byConversation = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const list = byConversation.get(hit.conversationId);
    if (list) list.push(hit);
    else byConversation.set(hit.conversationId, [hit]);
  }
  return conversations.flatMap((conversation) => {
    const found = byConversation.get(conversation.id);
    return found ? [{ conversation, hits: found }] : [];
  });
}
