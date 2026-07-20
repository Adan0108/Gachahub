import { communities as mockCommunities, posts } from "../data/mockData";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

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
  const { skipJsonHeader = false, ...fetchOptions } = options;

  if (USE_MOCKS) {
    await new Promise(resolve => setTimeout(resolve, 120));
    if (path === backendRoutes.health) return { status: "ok", mock: true };
    if (path === backendRoutes.currentUser) return null;
    if (path.startsWith("/chat")) return [];
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

function withQuery(path, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });

  return `${path}${params.toString() ? `?${params}` : ""}`;
}

async function getGames(query = {}) {
  const response = await request(withQuery(backendRoutes.games, query));
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
  request,
  getHealth: () => request(backendRoutes.health, { skipJsonHeader: true }),
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
  getChatConversations: () => request(backendRoutes.chatConversations),
  getChatRequests: () => request(backendRoutes.chatRequests),
  getChatMessages: (conversationId, query = {}) => request(withQuery(backendRoutes.chatMessages(conversationId), query)),
  createDirectMessage: ({ recipientUserId, message }) => request(backendRoutes.chatDirect, {
    method: "POST",
    body: JSON.stringify({
      recipientUserId,
      message: encryptedMessagePayload(message),
    }),
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
