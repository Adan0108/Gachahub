import { mockCategories, mockGames, posts } from "./mockData";

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const backendRoutes = {
  health: "/health",
  games: "/games",
  game: slug => `/games/${slug}`,
  gameCategories: gameSlug => `/games/${gameSlug}/categories`,
  currentUser: "/users/me",
  chatConversations: "/chat/conversations",
  chatRequests: "/chat/requests",
  chatDirect: "/chat/direct",
  chatMessages: conversationId => `/chat/conversations/${conversationId}/messages`,
  chatAcceptRequest: conversationId => `/chat/requests/${conversationId}/accept`,
  chatDeclineRequest: conversationId => `/chat/requests/${conversationId}/decline`,
  chatBlockConversation: conversationId => `/chat/conversations/${conversationId}/block`,
  chatDelivered: "/chat/messages/delivered",
  chatRead: conversationId => `/chat/conversations/${conversationId}/read`,
};

export function communitySymbol(name = "") {
  const lower = name.toLowerCase();
  if (lower.includes("wuthering")) return "\u263e";
  if (lower.includes("honkai")) return "\u2727";
  if (lower.includes("genshin")) return "\u2726";
  if (lower.includes("zenless")) return "Z";
  if (lower.includes("gray") || lower.includes("raven")) return "\u25c7";
  return name.trim().charAt(0).toUpperCase() || "\u2726";
}

export function formatCount(value) {
  const number = Number(value || 0);
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return String(number);
}

export function normalizeGame(game) {
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

export function fallbackGames(search = "") {
  const query = search.trim().toLowerCase();
  const items = query
    ? mockGames.filter(game => `${game.name} ${game.slug} ${game.description}`.toLowerCase().includes(query))
    : mockGames;

  return {
    items: items.map(normalizeGame),
    meta: { total: items.length, source: "local" },
  };
}

export function fallbackGame(slug) {
  const game = mockGames.find(item => item.slug === slug || item.id === slug);
  return game ? normalizeGame(game) : null;
}

export function fallbackPosts({ gameSlug, search = "" } = {}) {
  const query = search.trim().toLowerCase();
  return posts.filter(post => {
    const matchesGame = gameSlug ? post.gameSlug === gameSlug : true;
    const matchesSearch = query ? `${post.title} ${post.author} ${post.tag}`.toLowerCase().includes(query) : true;
    return matchesGame && matchesSearch;
  });
}

export function fallbackCategories() {
  return mockCategories;
}

function withQuery(path, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });

  return `${path}${params.toString() ? `?${params}` : ""}`;
}

async function request(path, options = {}) {
  const { skipJsonHeader = false, ...fetchOptions } = options;

  if (USE_MOCKS) return mockResponse(path);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      ...(skipJsonHeader ? {} : { "Content-Type": "application/json" }),
      ...fetchOptions.headers,
    },
    ...fetchOptions,
  });

  if (!response.ok) {
    let message;
    try {
      const errorBody = await response.json();
      message = errorBody.message || errorBody.error || JSON.stringify(errorBody);
    } catch {
      message = await response.text().catch(() => "");
    }
    throw new Error(message || `API request failed: ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}

async function mockResponse(path) {
  await new Promise(resolve => setTimeout(resolve, 120));
  const [pathname, queryString] = path.split("?");
  const params = new URLSearchParams(queryString || "");

  if (pathname === backendRoutes.health) return { status: "ok" };
  if (pathname === backendRoutes.currentUser) return null;
  if (pathname === backendRoutes.games) return fallbackGames(params.get("search") || "");
  if (pathname.startsWith("/games/") && pathname.endsWith("/categories")) return fallbackCategories();
  if (pathname.startsWith("/games/")) {
    const slug = pathname.split("/")[2];
    const game = mockGames.find(item => item.slug === slug || item.id === slug);
    if (!game) throw new Error("Game not found");
    return game;
  }
  if (pathname.startsWith("/chat")) return [];
  return null;
}

function encryptedMessagePayload({
  ciphertext,
  encryptionMeta,
  contentType = "TEXT",
  clientMessageId,
  replyToId,
}) {
  return {
    ciphertext,
    ...(encryptionMeta ? { encryptionMeta } : {}),
    ...(contentType ? { contentType } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(replyToId ? { replyToId } : {}),
  };
}

export const api = {
  baseUrl: API_BASE_URL,
  usingMocks: USE_MOCKS,
  getHealth: () => request(backendRoutes.health, { skipJsonHeader: true }),
  getGames: async (query = {}) => {
    const response = await request(withQuery(backendRoutes.games, query));
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizeGame),
      meta: response.meta || { total: items.length },
    };
  },
  getCommunity: async slug => normalizeGame(await request(backendRoutes.game(slug))),
  getCategories: gameSlug => request(backendRoutes.gameCategories(gameSlug)),
  getProfile: () => request(backendRoutes.currentUser),
  getHome: async ({ search = "" } = {}) => {
    const games = await api.getGames({ status: "ACTIVE", search, limit: 20 });
    return { communities: games.items, posts: fallbackPosts({ search }), meta: games.meta };
  },
  getChatConversations: () => request(backendRoutes.chatConversations),
  getChatRequests: () => request(backendRoutes.chatRequests),
  getChatMessages: (conversationId, query = {}) => request(withQuery(backendRoutes.chatMessages(conversationId), query)),
  createDirectMessage: ({ recipientUserId, message }) => request(backendRoutes.chatDirect, {
    method: "POST",
    body: JSON.stringify({ recipientUserId, message: encryptedMessagePayload(message) }),
  }),
  sendChatMessage: (conversationId, message) => request(backendRoutes.chatMessages(conversationId), {
    method: "POST",
    body: JSON.stringify({ message: encryptedMessagePayload(message) }),
  }),
  acceptChatRequest: conversationId => request(backendRoutes.chatAcceptRequest(conversationId), { method: "POST" }),
  declineChatRequest: conversationId => request(backendRoutes.chatDeclineRequest(conversationId), { method: "POST" }),
  blockChatConversation: conversationId => request(backendRoutes.chatBlockConversation(conversationId), { method: "POST" }),
  markChatDelivered: messageIds => request(backendRoutes.chatDelivered, {
    method: "POST",
    body: JSON.stringify({ messageIds }),
  }),
  markChatRead: (conversationId, lastReadMessageId) => request(backendRoutes.chatRead(conversationId), {
    method: "POST",
    body: JSON.stringify(lastReadMessageId ? { lastReadMessageId } : {}),
  }),
};
