import { describe, expect, it } from 'vitest';
import { conversationMatches, groupHitsByConversation } from './conversationSearch';
import { parseSearchQuery } from './searchFolding';

const person = (userId: string, name: string, username: string | null = null, state = 'ACTIVE') => ({
  userId,
  state,
  user: { name, username },
});

const dm = {
  id: 'dm',
  type: 'DIRECT',
  participants: [person('me', 'Me', 'myself'), person('bob', 'Bob Marley', 'MinecraftBob')],
};

const group = {
  id: 'group',
  type: 'GROUP',
  title: 'Weekend Plans',
  participants: [
    person('me', 'Me', 'myself'),
    person('ann', 'Ánn Lee', 'annlee'),
    person('gone', 'Zed', 'zed99', 'ARCHIVED'),
  ],
};

const matches = (conversation: typeof dm | typeof group, query: string) =>
  conversationMatches(conversation, 'me', parseSearchQuery(query));

describe('conversationMatches', () => {
  it("finds a direct chat by the person's name", () => {
    expect(matches(dm, 'marley')).toBe(true);
  });

  it("finds a direct chat by the person's @handle, with or without the @", () => {
    expect(matches(dm, '@minecraftbob')).toBe(true);
    expect(matches(dm, 'minecraft')).toBe(true);
  });

  it('finds a group by its title', () => {
    expect(matches(group, 'weekend')).toBe(true);
  });

  it("finds a group by a member's name or @handle", () => {
    expect(matches(group, 'ann lee')).toBe(true);
    expect(matches(group, '@annlee')).toBe(true);
  });

  it('ignores case and accents', () => {
    expect(matches(group, 'ANN')).toBe(true);
    expect(matches(dm, 'MARLEY')).toBe(true);
  });

  it('needs every word to match somewhere', () => {
    expect(matches(group, 'weekend annlee')).toBe(true);
    expect(matches(group, 'weekend nobody')).toBe(false);
  });

  it('does not match you or people who are no longer in the group', () => {
    expect(matches(group, 'myself')).toBe(false);
    expect(matches(group, 'zed99')).toBe(false);
  });

  it('does not match when there is nothing to search for', () => {
    expect(matches(dm, '   ')).toBe(false);
  });

  it('copes with a person who has no handle yet', () => {
    const noHandle = { ...dm, participants: [person('me', 'Me'), person('bob', 'Bob Marley')] };
    expect(matches(noHandle, 'bob')).toBe(true);
    expect(matches(noHandle, '@bob')).toBe(false);
  });
});

describe('groupHitsByConversation', () => {
  const hit = (messageId: string, conversationId: string) => ({ messageId, conversationId, text: messageId });

  it('groups hits per conversation in list order, skipping conversations without one', () => {
    const groups = groupHitsByConversation(
      [hit('m1', 'group'), hit('m2', 'dm'), hit('m3', 'group'), hit('m4', 'elsewhere')],
      [dm, group, { id: 'empty' }],
    );

    expect(groups.map((entry) => entry.conversation.id)).toEqual(['dm', 'group']);
    expect(groups[1]?.hits.map((entry) => entry.messageId)).toEqual(['m1', 'm3']);
  });

  it('is empty without hits', () => {
    expect(groupHitsByConversation([], [dm])).toEqual([]);
  });
});
