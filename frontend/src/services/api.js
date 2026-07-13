import { communities as mockCommunities, posts } from "../data/mockData";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

export const backendRoutes = {

  games: "/games",
  game: slug => `/games/${slug}`,
  gameCategories: gameSlug => `/games/${gameSlug}/categories`,
  currentUser: "/users/me",

  posts: gameSlug => `/games/${gameSlug}/posts`,
  builds: gameSlug => `/games/${gameSlug}/builds`,
  teams: gameSlug => `/games/${gameSlug}/teams`,
  summaries: gameSlug => `/games/${gameSlug}/summaries`,
};

function communitySymbol(name = "") {
  const lower = name.toLowerCase();
  if (lower.includes("wuthering")) return "\u263e";
  if (lower.includes("honkai")) return "\u2727";
  if (lower.includes("genshin")) return "\u2726";
  if (lower.includes("zenless")) return "Z";
  if (lower.includes("gray") || lower.includes("raven")) return "\u25c7";
  return name.trim().charAt(0).toUpperCase() || "\u2726";
}

function formatCount(value) {
  const number = Number(value || 0);
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return String(number);
}

function normalizeGame(game) {
  return {
    id: game.id || game.slug,
    slug: game.slug,
    name: game.name,
    description: game.description,
    members: formatCount(game.memberCount),
    posts: formatCount(game.postCount),
    symbol: communitySymbol(game.name),
    iconUrl: game.iconUrl,
    bannerUrl: game.bannerUrl,
    developer: game.developer,
    publisher: game.publisher,
    status: game.status,
    categories: game.categories || [],
    raw: game,
  };
}

function normalizeMockCommunity(community) {
  return {
    id: community.id,
    slug: community.slug || community.id,
    name: community.name,
    description: community.description,
    members: community.members,
    posts: "0",
    symbol: community.symbol || communitySymbol(community.name),
    categories: [],
    raw: community,
  };
}

async function request(path, options = {}) {
  if (USE_MOCKS) {
    await new Promise(resolve => setTimeout(resolve, 120));
    if (path.includes("/categories")) return [];
    if (path.startsWith("/games/")) {
      const slug = path.split("/")[2];
      const game = mockCommunities.find(item => item.id === slug || item.slug === slug) || mockCommunities[0];
      return {
        id: game.id,
        slug: game.slug || game.id,
        name: game.name,
        description: game.description,
        memberCount: Number.parseInt(String(game.members).replace(/\D/g, ""), 10) || 0,
        postCount: 0,
      };
    }
    if (path.startsWith("/games")) return { items: mockCommunities, meta: { total: mockCommunities.length } };
    return { communities: mockCommunities, posts };
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}

async function getGames(query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });

  const response = await request(`${backendRoutes.games}${params.toString() ? `?${params}` : ""}`);
  const items = Array.isArray(response) ? response : response.items || [];

  return {
    items: items.map(normalizeGame),
    meta: response.meta || { total: items.length },
  };
}

async function getGame(slug) {
  const game = await request(backendRoutes.game(slug));
  return normalizeGame(game);
}

async function getCategories(gameSlug) {
  return request(backendRoutes.gameCategories(gameSlug));
}

export const api = {
  getHome: async () => {
    const games = await getGames({ status: "ACTIVE", limit: 20 }).catch(() => ({
      items: [],
      meta: { total: 0 },
    }));

    return {
      communities: games.items.length ? games.items : mockCommunities.map(normalizeMockCommunity),
      posts,
      meta: games.meta,
    };
  },
  getGames,
  getCommunity: getGame,
  getCategories,
  getProfile: () => request(backendRoutes.currentUser),

  getPosts: gameSlug => request(backendRoutes.posts(gameSlug)),
  getBuilds: gameSlug => request(backendRoutes.builds(gameSlug)),
  getTeams: gameSlug => request(backendRoutes.teams(gameSlug)),
  getSummaries: gameSlug => request(backendRoutes.summaries(gameSlug)),
  saveBuild: (gameSlug, build) => request(backendRoutes.builds(gameSlug), {
    method: "POST",
    body: JSON.stringify(build),
  }),
};
