import { keepPreviousData } from "@tanstack/react-query";
import { cursorFeedOptions } from "./cursorFeed";
import { api, fallbackCategories, fallbackGame, fallbackGames, fallbackPosts } from "./api";

// Normalizes an unpaginated, bare-array admin endpoint (categories, moderators) into the same
// { items, meta } shape every paginated admin query already returns, so useAdminList's generic
// `items: query.data?.items || []` reads correctly for these too.
function asItemsList(data) {
  const items = Array.isArray(data) ? data : data?.items || [];
  return { items, meta: { total: items.length } };
}

export const queryKeys = {
  health: ["health"],
  home: (search) => ["home", { search }],
  games: (search) => ["games", { search }],
  adminGames: {
    all: ["admin", "games"],
    list: (search, status) => ["admin", "games", { search, status }],
  },
  community: (slug) => ["community", slug],
  categories: (slug) => ["community-categories", slug],
  adminCategories: {
    all: (slug) => ["admin", "categories", slug],
    list: (slug, active) => ["admin", "categories", slug, { active }],
  },
  adminModerators: {
    all: (slug) => ["admin", "moderators", slug],
    list: (slug) => ["admin", "moderators", slug],
  },
  moderatedGames: ["moderated-games"],
  currentUser: ["current-user"],
  bannerOptions: ["profile-banner-options"],
  myPosts: ["posts", "mine"],
  posts: (search) => ["posts", { search }],
  post: (postId) => ["posts", "detail", postId],
  gameFeed: (slug, categorySlug, { sort = "latest", type = "", userId = "" } = {}) => ["game-feed", slug, { categorySlug, sort, type, userId }],
  followStatus: (userId) => ["follow-status", userId],
  comments: (postId) => ["comments", postId],
  replies: (commentId) => ["comment-replies", commentId],
  adminOverview: { all: ["admin", "overview"] },
  adminReports: {
    all: ["admin", "reports"],
    list: (status, page, limit = 20) => ["admin", "reports", { status, page, limit }],
  },
  adminUsers: {
    all: ["admin", "users"],
    list: (status, search, page) => ["admin", "users", { status, search, page }],
  },
  adminContent: {
    all: ["admin", "content"],
    list: (type, page, excludeHidden = false, limit = 20) => [
      "admin",
      "content",
      { type, page, excludeHidden, limit },
    ],
  },
  chatConversations: ["chat", "conversations"],
  chatArchivedConversations: ["chat", "archived"],
  chatRequests: ["chat", "requests"],
  chatMessages: (conversationId) => ["chat", "messages", conversationId],
  // Socket-pushed only - nobody ever fetches this over REST, useChatSocket just writes into it.
  chatTyping: (conversationId) => ["chat", "typing", conversationId],
  // Same idea: the one-shot "your message request was accepted" event, keyed per conversation.
  chatRequestAccepted: (conversationId) => ["chat", "request-accepted", conversationId],
};

export const queries = {
  health: () => ({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
    retry: 1,
    staleTime: 30_000,
  }),
  home: (search) => ({
    queryKey: queryKeys.home(search),
    queryFn: () => api.getHome({ search }),
    retry: 1,
    staleTime: 30_000,
  }),
  games: (search) => ({
    queryKey: queryKeys.games(search),
    queryFn: ({ signal }) => api.getGames({ status: "ACTIVE", search, limit: 20 }, { signal }),
    retry: 1,
    staleTime: 30_000,
  }),
  adminGames: (search = "", status = "") => ({
    queryKey: queryKeys.adminGames.list(search, status),
    queryFn: ({ signal }) => api.getGames({ search, status, page: 1, limit: 100 }, { signal }),
    retry: 1,
    staleTime: 15_000,
  }),
  community: (slug) => ({
    queryKey: queryKeys.community(slug),
    queryFn: () => api.getCommunity(slug),
    retry: 1,
    staleTime: 30_000,
  }),
  categories: (slug) => ({
    queryKey: queryKeys.categories(slug),
    queryFn: () => api.getCategories(slug),
    retry: 1,
    staleTime: 30_000,
  }),
  adminCategories: (slug, active = "") => ({
    queryKey: queryKeys.adminCategories.list(slug, active),
    queryFn: async ({ signal }) =>
      asItemsList(
        await api.getCategories(slug, active === "" ? {} : { isActive: active }, { signal }),
      ),
    enabled: Boolean(slug),
    retry: 1,
    staleTime: 15_000,
  }),
  adminModerators: (slug) => ({
    queryKey: queryKeys.adminModerators.list(slug),
    queryFn: async ({ signal }) => asItemsList(await api.getGameModerators(slug, { signal })),
    enabled: Boolean(slug),
    retry: 1,
    staleTime: 15_000,
  }),
  currentUser: () => ({
    queryKey: queryKeys.currentUser,
    queryFn: ({ signal }) => api.getCurrentUser({ signal }),
    retry: false,
    staleTime: 30_000,
  }),
  bannerOptions: () => ({
    queryKey: queryKeys.bannerOptions,
    queryFn: ({ signal }) => api.getBannerOptions({ signal }),
    retry: 1,
    staleTime: 5 * 60_000,
  }),
  moderatedGames: () => ({
    queryKey: queryKeys.moderatedGames,
    queryFn: ({ signal }) => api.listModeratedGames({ signal }),
    retry: 1,
    staleTime: 15_000,
  }),
  myPosts: () => ({
    queryKey: queryKeys.myPosts,
    queryFn: ({ signal }) => api.getMyPosts({ page: 1, limit: 20 }, { signal }),
    retry: 1,
    staleTime: 30_000,
  }),
  posts: (search) => ({
    queryKey: queryKeys.posts(search),
    queryFn: ({ signal }) =>
      api.getPosts({ page: 1, limit: 20, search, sort: "latest" }, { signal }),
    retry: 1,
    staleTime: 30_000,
  }),
  post: (postId) => ({
    queryKey: queryKeys.post(postId),
    queryFn: ({ signal }) => api.getPost(postId, { signal }),
    enabled: Boolean(postId),
    retry: 1,
    staleTime: 30_000,
  }),
  feed: (sort = "latest", filters = {}, userId = "", scope = null) =>
    cursorFeedOptions(["feed", sort, filters, userId, scope],
      ({ cursor, signal }) => api[sort === "for-you" ? "getForYouFeed" : sort === "trending" ? "getTrendingFeed" : "getLatestFeed"]({ ...filters, cursor }, { signal }),
      sort !== "for-you" || Boolean(userId)),
  gameFeed: (slug, categorySlug, { sort = "latest", type = "", userId = "" } = {}) =>
    cursorFeedOptions(queryKeys.gameFeed(slug, categorySlug, { sort, type, userId }),
      ({ cursor, signal }) => api.getGameFeed(slug, { limit: 20, sort, type, categorySlug, cursor }, { signal }), Boolean(slug)),
  followStatus: (userId) => ({
    queryKey: queryKeys.followStatus(userId),
    queryFn: ({ signal }) => api.getFollowStatus(userId, { signal }),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 30_000,
  }),
  comments: (postId) => ({
    queryKey: queryKeys.comments(postId),
    queryFn: ({ signal }) => api.getComments(postId, { page: 1, limit: 20 }, { signal }),
    enabled: Boolean(postId),
    retry: 1,
    staleTime: 15_000,
  }),
  replies: (commentId) => ({
    queryKey: queryKeys.replies(commentId),
    queryFn: ({ signal }) => api.getReplies(commentId, { page: 1, limit: 20 }, { signal }),
    enabled: Boolean(commentId),
    retry: 1,
    staleTime: 15_000,
  }),
  adminOverview: () => ({
    queryKey: queryKeys.adminOverview.all,
    queryFn: ({ signal }) => api.getAdminOverview({ signal }),
    retry: 1,
    staleTime: 30_000,
  }),
  adminReports: (status = "", page = 1, limit = 20) => ({
    queryKey: queryKeys.adminReports.list(status, page, limit),
    queryFn: ({ signal }) => api.listReports({ status, page, limit }, { signal }),
    placeholderData: keepPreviousData,
    retry: 1,
    staleTime: 15_000,
  }),
  adminUsers: (status = "", search = "", page = 1) => ({
    queryKey: queryKeys.adminUsers.list(status, search, page),
    queryFn: ({ signal }) => api.listAdminUsers({ status, search, page, limit: 20 }, { signal }),
    placeholderData: keepPreviousData,
    retry: 1,
    staleTime: 15_000,
  }),
  adminContent: (type = "", page = 1, { excludeHidden = false, limit = 20 } = {}) => ({
    queryKey: queryKeys.adminContent.list(type, page, excludeHidden, limit),
    queryFn: ({ signal }) =>
      api.listAdminContent({ type, page, limit, excludeHidden }, { signal }),
    placeholderData: keepPreviousData,
    retry: 1,
    staleTime: 15_000,
  }),
  // These three poll: refetchOnWindowFocus is off app-wide (Providers.jsx).
  // useChatSocket now delivers new messages live (backend already emits
  // "message:created"), so this is a reliability fallback, not the primary
  // delivery path - a longer interval than before since the socket push
  // handles the common case, and the backend's own delivery has no
  // retry/queue if a socket was briefly disconnected.
  chatConversations: () => ({
    queryKey: queryKeys.chatConversations,
    queryFn: api.getChatConversations,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 15_000,
  }),
  chatArchivedConversations: () => ({
    queryKey: queryKeys.chatArchivedConversations,
    queryFn: api.getArchivedChatConversations,
    retry: 1,
    staleTime: 10_000,
  }),
  chatRequests: () => ({
    queryKey: queryKeys.chatRequests,
    queryFn: api.getChatRequests,
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 15_000,
  }),
  chatMessages: (conversationId) => ({
    queryKey: queryKeys.chatMessages(conversationId),
    queryFn: () => api.getChatMessages(conversationId, { limit: 50 }),
    enabled: Boolean(conversationId),
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 15_000,
  }),
};

export const fallbacks = {
  home: (search) => {
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

