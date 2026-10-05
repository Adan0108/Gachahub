"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queries, queryKeys } from "../lib/queries";
import { useCurrentUser } from "./useCurrentUser";

/** The bell's data: the unread count is always live, the list only loads while the drawer is open. */
export function useNotifications({ listEnabled }) {
  const { isAuthenticated } = useCurrentUser();
  const queryClient = useQueryClient();

  const unread = useQuery({ ...queries.notificationUnreadCount(), enabled: isAuthenticated });
  const list = useInfiniteQuery({
    ...queries.notificationList(),
    enabled: isAuthenticated && listEnabled,
  });

  // Rows are patched in place: invalidating an infinite query refetches every page loaded so far.
  const patchRows = (patch) =>
    queryClient.setQueryData(
      queryKeys.notificationList,
      (data) =>
        data && {
          ...data,
          pages: data.pages.map((page) => ({ ...page, items: page.items.map(patch) })),
        },
    );
  const refreshCount = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.notificationUnreadCount });
  // A failed write means the optimistic rows were wrong, so let the server's list win.
  const refreshList = () => queryClient.invalidateQueries({ queryKey: queryKeys.notificationList });

  const markRead = useMutation({
    mutationFn: (notificationId) => api.markNotificationRead(notificationId),
    onMutate: (notificationId) =>
      patchRows((item) =>
        item.id === notificationId && !item.readAt
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    onError: refreshList,
    onSettled: refreshCount,
  });
  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onMutate: () =>
      patchRows((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() })),
    onError: refreshList,
    onSettled: refreshCount,
  });

  return {
    unreadCount: unread.data?.count ?? 0,
    items: list.data?.pages.flatMap((page) => page.items) ?? [],
    list,
    markRead,
    markAllRead,
  };
}
