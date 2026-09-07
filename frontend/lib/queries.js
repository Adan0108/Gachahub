import { api, fallbackCategories, fallbackGame, fallbackGames, fallbackPosts } from "./api";

export const queryKeys = {
  health: ["health"],
  home: (search) => ["home", { search }],
  games: (search) => ["games", { search }],
  community: (slug) => ["community", slug],
  categories: (slug) => ["community-categories", slug],
  currentUser: ["current-user"],
  profile: ["current-user"],
  myPosts: ["posts", "mine"],
  posts: (search) => ["posts", { search }],
  gameFeed: (slug, categorySlug) => ["game-feed", slug, { categorySlug }],
  followStatus: (userId) => ["follow-status", userId],
  comments: (postId) => ["comments", postId],
  replies: (commentId) => ["comment-replies", commentId],
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
  currentUser: () => ({
    queryKey: queryKeys.currentUser,
    queryFn: ({ signal }) => api.getCurrentUser({ signal }),
    retry: false,
    staleTime: 30_000,
  }),
  profile: () => queries.currentUser(),
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
  gameFeed: (slug, categorySlug) => ({
    queryKey: queryKeys.gameFeed(slug, categorySlug),
    queryFn: ({ signal }) =>
      api.getGameFeed(slug, { page: 1, limit: 20, sort: "latest", categorySlug }, { signal }),
    enabled: Boolean(slug),
    retry: 1,
    staleTime: 30_000,
  }),
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
