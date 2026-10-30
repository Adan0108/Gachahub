import { keepPreviousData } from "@tanstack/react-query";
import { cursorFeedOptions } from "./cursorFeed";
import { api, fallbackCategories, fallbackGame, fallbackGames, fallbackPosts } from "./api";
import { bindSignedInAccount } from "./mls/mlsAccountSession";
// Normalizes an unpaginated, bare-array admin endpoint (categories, moderators) into the same
// { items, meta } shape every paginated admin query already returns, so useAdminList's generic
// `items: query.data?.items || []` reads correctly for these too.
function asItemsList(data: any) {
  const items = Array.isArray(data) ? data : data?.items || [];
  return { items, meta: { total: items.length } };
}
// Unpinned conversations per inbox page; every pinned one comes with the first.
export const INBOX_PAGE_SIZE = 50;
export const queryKeys = {
  health: ["health"],
  home: (search: any) => ["home", { search }],
  games: (search: any) => ["games", { search }],
  adminGames: {
    all: ["admin", "games"],
    list: (search: any, status: any) => ["admin", "games", { search, status }],
  },
  community: (slug: any) => ["community", slug],
  gameJoinStatus: (slug: any, userId: any) => ["game-join-status", userId, slug],
  joinedGames: (userId: any) => ["joined-games", userId],
  categories: (slug: any) => ["community-categories", slug],
  adminCategories: {
    all: (slug: any) => ["admin", "categories", slug],
    list: (slug: any, active: any) => ["admin", "categories", slug, { active }],
  },
  adminModerators: {
    all: (slug: any) => ["admin", "moderators", slug],
    list: (slug: any) => ["admin", "moderators", slug],
  },
  moderatedGames: ["moderated-games"],
  currentUser: ["current-user"],
  wallet: ["wallet"],
  walletLedger: ["wallet", "ledger"],
  bannerOptions: ["profile-banner-options"],
  myPosts: ["posts", "mine"],
  posts: (search: any) => ["posts", { search }],
  post: (postId: any) => ["posts", "detail", postId],
  gameFeed: (
    slug: any,
    categorySlug: any,
    { sort = "latest", type = "", userId = "" }: any = {},
  ) => ["game-feed", slug, { categorySlug, sort, type, userId }],
  followStatus: (userId: any) => ["follow-status", userId],
  userProfile: (userId: any) => ["users", userId, "profile"],
  userPosts: (userId: any) => ["users", userId, "posts"],
  followList: (userId: any, kind: any) => ["users", userId, kind],
  comments: (postId: any) => ["comments", postId],
  replies: (commentId: any) => ["comment-replies", commentId],
  adminOverview: { all: ["admin", "overview"] },

  adminUsers: {
    all: ["admin", "users"],
    list: (status: any, search: any, page: any) => ["admin", "users", { status, search, page }],
  },
  adminContent: {
    all: ["admin", "content"],
    list: (type: any, page: any, excludeHidden: any = false, limit: any = 20) => [
      "admin",
      "content",
      { type, page, excludeHidden, limit },
    ],
  },
  // One root so a single invalidate refreshes both the list and the badge count.
  notifications: ["notifications"],
  notificationList: ["notifications", "list"],
  notificationUnreadCount: ["notifications", "unread-count"],
  myPresence: ["presence", "me"],
  chatConversations: ["chat", "conversations"],
  chatArchivedConversations: ["chat", "archived"],
  chatRequests: ["chat", "requests"],
  chatBlockedUsers: ["chat", "blocked"],
  chatMessages: (conversationId: any) => ["chat", "messages", conversationId],
  chatEmotes: ["chat", "emotes"],
  communityChannels: (slug: any) => ["community-chat", slug, "channels"],
  communityMessages: (slug: any, channelId: any) => ["community-chat", slug, "messages", channelId],
  communityMembers: (slug: any, query: any) => ["community-chat", slug, "members", query],
  // Socket-pushed only - nobody ever fetches this over REST, useChatSocket just writes into it.
  chatTyping: (conversationId: any) => ["chat", "typing", conversationId],
  // Same idea: the one-shot "your message request was accepted" event, keyed per conversation.
  chatRequestAccepted: (conversationId: any) => ["chat", "request-accepted", conversationId],
};
export const queries = {
  health: () => ({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    retry: 1,
    staleTime: 30000,
  }),
  home: (search: any) => ({
    queryKey: queryKeys.home(search),
    queryFn: () => api.getHome({ search }),
    retry: 1,
    staleTime: 30000,
  }),
  games: (search: any) => ({
    queryKey: queryKeys.games(search),
    queryFn: ({ signal }: any) => api.getGames({ status: "ACTIVE", search, limit: 20 }, { signal }),
    retry: 1,
    staleTime: 30000,
  }),
  adminGames: (search: any = "", status: any = "") => ({
    queryKey: queryKeys.adminGames.list(search, status),
    queryFn: ({ signal }: any) => api.getGames({ search, status, page: 1, limit: 100 }, { signal }),
    retry: 1,
    staleTime: 15000,
  }),
  community: (slug: any) => ({
    queryKey: queryKeys.community(slug),
    queryFn: () => api.getCommunity(slug),
    retry: 1,
    staleTime: 30000,
  }),
  gameJoinStatus: (slug: any, userId: any) => ({
    queryKey: queryKeys.gameJoinStatus(slug, userId),
    queryFn: ({ signal }: any) => api.getGameJoinStatus(slug, { signal }),
    enabled: Boolean(slug && userId),
    retry: false,
    gcTime: 0,
  }),
  joinedGames: (userId: any) => ({
    queryKey: queryKeys.joinedGames(userId),
    queryFn: ({ signal }: any) => api.getJoinedGames({ signal }),
    enabled: Boolean(userId),
    retry: false,
    gcTime: 0,
  }),
  categories: (slug: any) => ({
    queryKey: queryKeys.categories(slug),
    queryFn: () => api.getCategories(slug),
    retry: 1,
    staleTime: 30000,
  }),
  adminCategories: (slug: any, active: any = "") => ({
    queryKey: queryKeys.adminCategories.list(slug, active),
    queryFn: async ({ signal }: any) =>
      asItemsList(
        await api.getCategories(slug, active === "" ? {} : { isActive: active }, { signal }),
      ),
    enabled: Boolean(slug),
    retry: 1,
    staleTime: 15000,
  }),
  adminModerators: (slug: any) => ({
    queryKey: queryKeys.adminModerators.list(slug),
    queryFn: async ({ signal }: any) => asItemsList(await api.getGameModerators(slug, { signal })),
    enabled: Boolean(slug),
    retry: 1,
    staleTime: 15000,
  }),
  currentUser: () => ({
    queryKey: queryKeys.currentUser,
    queryFn: async ({ signal }: any) => {
      const user = await api.getCurrentUser({ signal });
      // Before anything reads the user: local encrypted data is per account, and a different one reloads the page
      bindSignedInAccount(user?.id);
      return user;
    },
    retry: false,
    staleTime: 30000,
  }),
  wallet: () => ({
    queryKey: queryKeys.wallet,
    queryFn: ({ signal }: any) => api.getWallet({ signal }),
    staleTime: 15000,
  }),
  walletLedger: () => ({
    queryKey: queryKeys.walletLedger,
    queryFn: ({ signal }: any) => api.getWalletLedger({ signal }),
    staleTime: 15000,
  }),
  bannerOptions: () => ({
    queryKey: queryKeys.bannerOptions,
    queryFn: ({ signal }: any) => api.getBannerOptions({ signal }),
    retry: 1,
    staleTime: 5 * 60000,
  }),
  moderatedGames: () => ({
    queryKey: queryKeys.moderatedGames,
    queryFn: ({ signal }: any) => api.listModeratedGames({ signal }),
    retry: 1,
    staleTime: 15000,
  }),
  myPosts: () => ({
    queryKey: queryKeys.myPosts,
    queryFn: ({ signal }: any) => api.getMyPosts({ page: 1, limit: 20 }, { signal }),
    retry: 1,
    staleTime: 30000,
  }),
  posts: (search: any) => ({
    queryKey: queryKeys.posts(search),
    queryFn: ({ signal }: any) =>
      api.getPosts({ page: 1, limit: 20, search, sort: "latest" }, { signal }),
    retry: 1,
    staleTime: 30000,
  }),
  post: (postId: any) => ({
    queryKey: queryKeys.post(postId),
    queryFn: ({ signal }: any) => api.getPost(postId, { signal }),
    enabled: Boolean(postId),
    retry: 1,
    staleTime: 30000,
  }),
  feed: (sort: any = "latest", filters: any = {}, userId: any = "", scope: any = null) =>
    cursorFeedOptions(
      ["feed", sort, filters, userId, scope],
      ({ cursor, signal }: any) =>
        api[
          sort === "for-you"
            ? "getForYouFeed"
            : sort === "trending"
              ? "getTrendingFeed"
              : "getLatestFeed"
        ]({ ...filters, cursor }, { signal }),
      sort !== "for-you" || Boolean(userId),
    ),
  gameFeed: (slug: any, categorySlug: any, { sort = "latest", type = "", userId = "" }: any = {}) =>
    cursorFeedOptions(
      queryKeys.gameFeed(slug, categorySlug, { sort, type, userId }),
      ({ cursor, signal }: any) =>
        api.getGameFeed(slug, { limit: 20, sort, type, categorySlug, cursor }, { signal }),
      Boolean(slug),
    ),
  followStatus: (userId: any) => ({
    queryKey: queryKeys.followStatus(userId),
    queryFn: ({ signal }: any) => api.getFollowStatus(userId, { signal }),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 30000,
  }),
  userProfile: (userId: any) => ({
    queryKey: queryKeys.userProfile(userId),
    queryFn: ({ signal }: any) => api.getUserProfile(userId, { signal }),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 30_000,
  }),
  userPosts: (userId: any) => ({
    queryKey: queryKeys.userPosts(userId),
    queryFn: ({ signal }: any) => api.getUserPosts(userId, { page: 1, limit: 20 }, { signal }),
    enabled: Boolean(userId),
    retry: 1,
    staleTime: 30_000,
  }),
  comments: (postId: any) => ({
    queryKey: queryKeys.comments(postId),
    queryFn: ({ signal }: any) => api.getComments(postId, { page: 1, limit: 20 }, { signal }),
    enabled: Boolean(postId),
    retry: 1,
    staleTime: 15000,
  }),
  replies: (commentId: any) => ({
    queryKey: queryKeys.replies(commentId),
    queryFn: ({ signal }: any) => api.getReplies(commentId, { page: 1, limit: 20 }, { signal }),
    enabled: Boolean(commentId),
    retry: 1,
    staleTime: 15000,
  }),
  adminOverview: () => ({
    queryKey: queryKeys.adminOverview.all,
    queryFn: ({ signal }: any) => api.getAdminOverview({ signal }),
    retry: 1,
    staleTime: 30000,
  }),
  adminUsers: (status: any = "", search: any = "", page: any = 1) => ({
    queryKey: queryKeys.adminUsers.list(status, search, page),
    queryFn: ({ signal }: any) =>
      api.listAdminUsers({ status, search, page, limit: 20 }, { signal }),
    placeholderData: keepPreviousData,
    retry: 1,
    staleTime: 15000,
  }),
  adminContent: (
    type: any = "",
    page: any = 1,
    { excludeHidden = false, limit = 20 }: any = {},
  ) => ({
    queryKey: queryKeys.adminContent.list(type, page, excludeHidden, limit),
    queryFn: ({ signal }: any) =>
      api.listAdminContent({ type, page, limit, excludeHidden }, { signal }),
    placeholderData: keepPreviousData,
    retry: 1,
    staleTime: 15000,
  }),
  // These three poll: refetchOnWindowFocus is off app-wide (Providers.jsx).
  // useChatSocket now delivers new messages live (backend already emits
  // "message:created"), so this is a reliability fallback, not the primary
  // delivery path - a longer interval than before since the socket push
  // handles the common case, and the backend's own delivery has no
  // retry/queue if a socket was briefly disconnected.
  chatConversations: () => ({
    queryKey: queryKeys.chatConversations,
    queryFn: () => api.getChatConversations({ limit: INBOX_PAGE_SIZE }),
    retry: 1,
    staleTime: 10000,
    refetchInterval: 15000,
  }),
  // Infinite: each page's cursor is the last notification id; the bell enables it only while open.
  notificationList: () => ({
    queryKey: queryKeys.notificationList,
    queryFn: ({ pageParam, signal }: any) =>
      api.getNotifications({ limit: 20, cursor: pageParam }, { signal }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage: any) => lastPage.nextCursor ?? undefined,
    retry: 1,
    staleTime: 10000,
  }),
  // Pushed live over the socket (useNotificationSocket); the interval only covers a missed push.
  notificationUnreadCount: () => ({
    queryKey: queryKeys.notificationUnreadCount,
    queryFn: ({ signal }: any) => api.getNotificationUnreadCount({ signal }),
    retry: 1,
    staleTime: 30000,
    refetchInterval: 60000,
  }),
  chatBlockedUsers: () => ({
    queryKey: queryKeys.chatBlockedUsers,
    queryFn: ({ signal }: any) => api.getBlockedChatUsers({ signal }),
    retry: 1,
    staleTime: 15_000,
  }),
  // The inbox past its first page. Keyed by where it starts, so a first page that moved never
  // leaves a gap; under chatConversations, so anything that refreshes the inbox refreshes these too.
  chatOlderConversations: (start: { updatedAt: string; id: string } | null) => ({
    queryKey: [...queryKeys.chatConversations, "older", start?.id ?? null],
    queryFn: ({ pageParam }: any) =>
      api.getChatConversations({
        limit: INBOX_PAGE_SIZE,
        beforeUpdatedAt: pageParam.updatedAt,
        beforeId: pageParam.id,
      }),
    initialPageParam: start as { updatedAt: string; id: string },
    getNextPageParam: (lastPage: any[]) => {
      const last = lastPage.at(-1);
      return lastPage.length >= INBOX_PAGE_SIZE && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : undefined;
    },
    retry: 1,
    staleTime: 10000,
  }),
  chatArchivedConversations: () => ({
    queryKey: queryKeys.chatArchivedConversations,
    queryFn: api.getArchivedChatConversations,
    retry: 1,
    staleTime: 10000,
    refetchInterval: 15000,
  }),
  chatRequests: () => ({
    queryKey: queryKeys.chatRequests,
    queryFn: api.getChatRequests,
    retry: 1,
    staleTime: 10000,
    refetchInterval: 15000,
  }),
  myPresence: () => ({
    queryKey: queryKeys.myPresence,
    queryFn: api.getMyPresence,
    retry: 1,
    staleTime: 60_000,
  }),
  communityChannels: (slug: any) => ({
    queryKey: queryKeys.communityChannels(slug),
    queryFn: () => api.getCommunityChannels(slug),
    enabled: Boolean(slug),
    retry: false,
    staleTime: 15_000,
  }),
  chatEmotes: () => ({
    queryKey: queryKeys.chatEmotes,
    queryFn: api.getChatEmotes,
    retry: 1,
    staleTime: 5 * 60_000,
  }),
  chatMessages: (conversationId: any) => ({
    queryKey: queryKeys.chatMessages(conversationId),
    queryFn: () => api.getChatMessages(conversationId, { limit: 50 }),
    enabled: Boolean(conversationId),
    retry: 1,
    staleTime: 10000,
    refetchInterval: 15000,
  }),
};
export const fallbacks = {
  home: (search: any) => {
    const games = fallbackGames(search);
    const forYouPosts = fallbackPosts({ search });
    return {
      communities: games.items,
      forYouPosts,
      posts: forYouPosts,
      meta: games.meta,
    };
  },
  games: fallbackGames,
  community: fallbackGame,
  categories: fallbackCategories,
  posts: fallbackPosts,
};
