import { api, fallbackCategories, fallbackGame, fallbackGames, fallbackPosts } from "./api";

export const queryKeys = {
  health: ["health"],
  home: (search) => ["home", { search }],
  games: (search) => ["games", { search }],
  community: (slug) => ["community", slug],
  categories: (slug) => ["community-categories", slug],
  profile: ["profile"],
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
  profile: () => ({
    queryKey: queryKeys.profile,
    queryFn: api.getProfile,
    retry: 1,
    staleTime: 30_000,
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
