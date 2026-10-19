"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  peerIdOf,
  withBlockedChat,
  withBlockedPerson,
  withoutConversation,
} from "../../lib/chat/conversationCache";
import { queryKeys } from "../../lib/queries";

const LIST_KEYS = [
  queryKeys.chatConversations,
  queryKeys.chatRequests,
  queryKeys.chatArchivedConversations,
  queryKeys.chatBlockedUsers,
];

const DONE = {
  block: "Blocked.",
  unblock: "Unblocked.",
  archive: "Chat archived.",
  unarchive: "Moved back to your inbox.",
  remove: "Chat deleted.",
};
const FAILED = {
  block: "Couldn't block. Try again.",
  unblock: "Couldn't unblock. Try again.",
  archive: "Couldn't archive. Try again.",
  unarchive: "Couldn't move it back. Try again.",
  remove: "Couldn't delete. Try again.",
};

/**
 * Block, unblock, archive, unarchive and delete for any chat in the list. Each takes effect on screen
 * at once and says so with `notify`; the server follows, and if it refuses the lists go back as they
 * were with a message saying so. Archive, unarchive and delete tell `onGone` which chat left once the server agreed.
 */
export function useConversationActions({ userId, onGone, notify } = {}) {
  const queryClient = useQueryClient();

  const refresh = () =>
    Promise.all([...LIST_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))]);

  /** `change(list, variable, listKey)` returns the list as it should look right now. */
  const instant = (name, mutationFn, change, { leavesList = false } = {}) => ({
    mutationFn,
    onMutate: async (variable) => {
      await Promise.all(LIST_KEYS.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      const before = LIST_KEYS.map((queryKey) => [queryKey, queryClient.getQueryData(queryKey)]);
      // Read before changing: the other person of a chat is found in the list as it was
      const inbox = queryClient.getQueryData(queryKeys.chatConversations);
      for (const queryKey of LIST_KEYS) {
        queryClient.setQueryData(queryKey, (list) => change(list, variable, queryKey, inbox));
      }
      notify?.(DONE[name]);
      return { before };
    },
    onSuccess: (_result, variable) => {
      if (leavesList) onGone?.(variable);
    },
    onError: (_error, _variable, context) => {
      for (const [queryKey, list] of context?.before ?? [])
        queryClient.setQueryData(queryKey, list);
      notify?.(FAILED[name]);
    },
    onSettled: refresh,
  });

  const leaves = (list, conversationId) => withoutConversation(list, conversationId);

  return {
    block: useMutation(
      instant(
        "block",
        (conversationId) => api.blockChatConversation(conversationId),
        (list, conversationId, queryKey, inbox) => {
          // A request leaves the requests; any other chat stays, marked blocked
          if (queryKey === queryKeys.chatRequests) return withoutConversation(list, conversationId);
          const personId =
            peerIdOf(inbox, conversationId, userId) ?? peerIdOf(list, conversationId, userId);
          return personId ? withBlockedChat(list, conversationId, personId, true) : list;
        },
      ),
    ),
    unblock: useMutation(
      instant(
        "unblock",
        (personId) => api.unblockChatUser(personId),
        (list, personId, queryKey) =>
          // The Blocked list is { items }, the chat lists are arrays
          queryKey === queryKeys.chatBlockedUsers
            ? list?.items
              ? { ...list, items: list.items.filter((person) => person.id !== personId) }
              : list
            : withBlockedPerson(list, personId, false),
      ),
    ),
    archive: useMutation(
      instant(
        "archive",
        (id) => api.archiveChatConversation(id),
        (list, id, queryKey) =>
          queryKey === queryKeys.chatConversations ? leaves(list, id) : list,
        { leavesList: true },
      ),
    ),
    unarchive: useMutation(
      instant(
        "unarchive",
        (id) => api.unarchiveChatConversation(id),
        (list, id, queryKey) =>
          queryKey === queryKeys.chatArchivedConversations ? leaves(list, id) : list,
        { leavesList: true },
      ),
    ),
    remove: useMutation(
      instant(
        "remove",
        (id) => api.deleteChatConversation(id),
        (list, id) => leaves(list, id),
        {
          leavesList: true,
        },
      ),
    ),
  };
}
