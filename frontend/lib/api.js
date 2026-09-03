import { mockCategories, mockGames, posts } from "./mockData";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const backendRoutes = {
  health: "/health",
  games: "/games",
  game: (slug) => `/games/${encodePathParam(slug)}`,
  gameCategories: (gameSlug) => `/games/${encodePathParam(gameSlug)}/categories`,
  currentUser: "/users/me",
  signInEmail: "/api/auth/sign-in/email",
  signUpEmail: "/api/auth/sign-up/email",
  chatConversations: "/chat/conversations",
  chatRequests: "/chat/requests",
  chatDirect: "/chat/direct",
  chatMessages: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/messages`,
  chatAcceptRequest: (conversationId) => `/chat/requests/${encodePathParam(conversationId)}/accept`,
  chatDeclineRequest: (conversationId) =>
    `/chat/requests/${encodePathParam(conversationId)}/decline`,
  chatBlockConversation: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/block`,
  chatDelivered: "/chat/messages/delivered",
  chatRead: (conversationId) => `/chat/conversations/${encodePathParam(conversationId)}/read`,
};

function encodePathParam(value) {
  return encodeURIComponent(String(value || ""));
}

function decodePathParam(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

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
    ? mockGames.filter((game) =>
        `${game.name} ${game.slug} ${game.description}`.toLowerCase().includes(query),
      )
    : mockGames;

  return {
    items: items.map(normalizeGame),
    meta: { total: items.length, source: "local" },
  };
}

export function fallbackGame(slug) {
  const game = mockGames.find((item) => item.slug === slug || item.id === slug);
  return game ? normalizeGame(game) : null;
}

export function fallbackPosts({ gameSlug, search = "" } = {}) {
  const query = search.trim().toLowerCase();
  return posts
    .filter((post) => {
      const matchesGame = gameSlug ? post.gameSlug === gameSlug : true;
      const game = mockGames.find((item) => item.slug === post.gameSlug);
      const matchesSearch = query
        ? `${post.title} ${post.author} ${post.tag} ${game?.name || ""}`
            .toLowerCase()
            .includes(query)
        : true;
      return matchesGame && matchesSearch;
    })
    .map((post) => {
      const game = mockGames.find((item) => item.slug === post.gameSlug);
      return {
        ...post,
        gameName: game?.name || post.gameSlug,
        gameSymbol: game ? communitySymbol(game.name) : communitySymbol(post.gameSlug),
      };
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
  const { headers, body, ...fetchOptions } = options;

  if (USE_MOCKS) return mockResponse(path);

  const shouldSendJsonHeader = body !== undefined && !(body instanceof FormData);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      ...(shouldSendJsonHeader ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
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

function mutation(path, payload, options = {}) {
  const { authHeaders, headers, ...fetchOptions } = options;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return request(path, {
    ...fetchOptions,
    method: fetchOptions.method || "POST",
    headers: {
      ...mutationAuthHeaders(authHeaders),
      ...headers,
    },
    body,
  });
}

function mutationAuthHeaders(headers) {
  return headers || {};
}

async function mockResponse(path) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const [pathname, queryString] = path.split("?");
  const params = new URLSearchParams(queryString || "");

  if (pathname === backendRoutes.health) return { status: "ok" };
  if (pathname === backendRoutes.currentUser) return null;
  if (pathname === backendRoutes.signInEmail || pathname === backendRoutes.signUpEmail)
    return { ok: true };
  if (pathname === backendRoutes.games) return fallbackGames(params.get("search") || "");
  if (pathname.startsWith("/games/") && pathname.endsWith("/categories"))
    return fallbackCategories();
  if (pathname.startsWith("/games/")) {
    const slug = decodePathParam(pathname.split("/")[2]);
    const game = mockGames.find((item) => item.slug === slug || item.id === slug);
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
  getHealth: () => request(backendRoutes.health),
  getGames: async (query = {}, options = {}) => {
    const response = await request(withQuery(backendRoutes.games, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizeGame),
      meta: response.meta || { total: items.length },
    };
  },
  getCommunity: async (slug) => normalizeGame(await request(backendRoutes.game(slug))),
  getCategories: (gameSlug) => request(backendRoutes.gameCategories(gameSlug)),
  getProfile: () => request(backendRoutes.currentUser),
  signIn: ({ email, password }) =>
    mutation(backendRoutes.signInEmail, {
      email,
      password,
    }),
  signUp: ({ name, email, password }) =>
    mutation(backendRoutes.signUpEmail, {
      name,
      email,
      password,
    }),
  getHome: async ({ search = "" } = {}) => {
    const games = await api.getGames({ status: "ACTIVE", search, limit: 20 });
    const forYouPosts = fallbackPosts({ search });
    return {
      communities: games.items,
      forYouPosts,
      posts: forYouPosts,
      meta: games.meta,
    };
  },
  getChatConversations: () => request(backendRoutes.chatConversations),
  getChatRequests: () => request(backendRoutes.chatRequests),
  getChatMessages: (conversationId, query = {}) =>
    request(withQuery(backendRoutes.chatMessages(conversationId), query)),
  createDirectMessage: ({ recipientUserId, message }) =>
    mutation(backendRoutes.chatDirect, {
      recipientUserId,
      message: encryptedMessagePayload(message),
    }),
  sendChatMessage: (conversationId, message) =>
    mutation(backendRoutes.chatMessages(conversationId), {
      message: encryptedMessagePayload(message),
    }),
  acceptChatRequest: (conversationId) => mutation(backendRoutes.chatAcceptRequest(conversationId)),
  declineChatRequest: (conversationId) =>
    mutation(backendRoutes.chatDeclineRequest(conversationId)),
  blockChatConversation: (conversationId) =>
    mutation(backendRoutes.chatBlockConversation(conversationId)),
  markChatDelivered: (messageIds) => mutation(backendRoutes.chatDelivered, { messageIds }),
  markChatRead: (conversationId, lastReadMessageId) =>
    mutation(
      backendRoutes.chatRead(conversationId),
      lastReadMessageId ? { lastReadMessageId } : {},
    ),
};
