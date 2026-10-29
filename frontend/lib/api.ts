import { mockCategories, mockGames, posts } from "./mockData";
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
// Dev-only: a production build must never be able to fake an admin session or the API layer.
const previewAllowed = process.env.NODE_ENV !== "production";
export const ADMIN_PREVIEW = previewAllowed && process.env.NEXT_PUBLIC_ADMIN_PREVIEW === "true";
export const USE_MOCKS = previewAllowed && process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export interface ApiError extends Error {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
}

export interface ConfirmedMediaUpload {
  mediaUploadId: string;
  fileName?: string;
  resourceType?: "IMAGE" | "VIDEO";
  secureUrl?: string;
  [key: string]: unknown;
}
export const backendRoutes = {
  health: "/health",
  games: "/games",
  game: (slug: any) => `/games/${encodePathParam(slug)}`,
  gameCategories: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/categories`,
  gameModerators: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/moderators`,
  gameModerator: (gameSlug: any, userId: any) =>
    `/games/${encodePathParam(gameSlug)}/moderators/${encodePathParam(userId)}`,
  gamesModerated: "/games/moderated",
  gamesJoined: "/games/joined",
  gameJoin: (slug: any) => `/games/${encodePathParam(slug)}/join`,
  gameJoinStatus: (slug: any) => `/games/${encodePathParam(slug)}/join-status`,
  gameBranding: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/branding`,
  gameArchive: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/archive`,
  gameRestore: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/restore`,
  gameFlag: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/flag`,
  adminOverview: "/admin/overview",
  platformCases: "/moderation/cases",
  platformCase: (caseId: any) => `/moderation/cases/${encodePathParam(caseId)}`,
  gameCases: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/moderation/cases`,
  gameCase: (gameSlug: any, caseId: any) => `/games/${encodePathParam(gameSlug)}/moderation/cases/${encodePathParam(caseId)}`,
  adminUsers: "/admin/users",
  adminUserStatus: (userId: any) => `/admin/users/${encodePathParam(userId)}/status`,
  adminContent: "/admin/content",
  postHide: (gameSlug: any, postId: any) =>
    `/games/${encodePathParam(gameSlug)}/posts/${encodePathParam(postId)}/hide`,
  postRestore: (gameSlug: any, postId: any) =>
    `/games/${encodePathParam(gameSlug)}/posts/${encodePathParam(postId)}/restore`,
  commentHide: (gameSlug: any, commentId: any) =>
    `/games/${encodePathParam(gameSlug)}/comments/${encodePathParam(commentId)}/hide`,
  commentRestore: (gameSlug: any, commentId: any) =>
    `/games/${encodePathParam(gameSlug)}/comments/${encodePathParam(commentId)}/restore`,
  currentUser: "/users/me",
  completeOnboarding: "/users/me/onboarding",
  userAvatar: "/users/me/avatar",
  userBanner: "/users/me/banner",
  userBannerOptions: "/users/me/banner-options",
  usernameAvailable: "/users/username-available",
  userSearch: "/users/search",
  signInEmail: "/api/auth/sign-in/email",
  signUpEmail: "/api/auth/sign-up/email",
  signOut: "/api/auth/sign-out",
  myPosts: "/posts/mine",
  posts: "/posts",
  post: (postId: any) => `/posts/${encodePathParam(postId)}`,
  latestFeed: "/feed/latest",
  trendingFeed: "/feed/trending",
  forYouFeed: "/feed/for-you",
  gameFeed: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/feed`,
  postLike: (postId: any) => `/posts/${encodePathParam(postId)}/like`,
  userFollow: (userId: any) => `/users/${encodePathParam(userId)}/follow`,
  followStatus: (userId: any) => `/users/${encodePathParam(userId)}/follow-status`,
  postComments: (postId: any) => `/posts/${encodePathParam(postId)}/comments`,
  commentReplies: (commentId: any) => `/comments/${encodePathParam(commentId)}/replies`,
  commentLike: (commentId: string) => `/comments/${encodePathParam(commentId)}/like`,
  wallet: "/wallet",
  walletLedger: "/wallet/ledger",
  walletCheckIn: "/wallet/check-in",
  reports: "/reports",
  notifications: "/notifications",
  notificationsUnreadCount: "/notifications/unread-count",
  notificationsReadAll: "/notifications/read-all",
  notificationRead: (notificationId: any) =>
    `/notifications/${encodePathParam(notificationId)}/read`,
  mediaSignatures: "/media/uploads/signatures",
  mediaConfirm: "/media/uploads/confirm",
  chatConversations: "/chat/conversations",
  chatArchivedConversations: "/chat/conversations/archived",
  chatRequests: "/chat/requests",
  chatDirect: "/chat/direct",
  chatMessages: (conversationId: any) =>
    `/chat/conversations/${encodePathParam(conversationId)}/messages`,
  chatMessage: (messageId: any) => `/chat/messages/${encodePathParam(messageId)}`,
  chatMessageEdits: (messageId: any) => `/chat/messages/${encodePathParam(messageId)}/edits`,
  chatMessageReactions: (messageId: any) =>
    `/chat/messages/${encodePathParam(messageId)}/reactions`,
  chatEmotes: '/chat/emotes',
  communityChat: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/chat`,
  communityChatMembers: (gameSlug: any) => `/games/${encodePathParam(gameSlug)}/chat/members`,
  communityChatMessages: (gameSlug: any, channelId: any) =>
    `/games/${encodePathParam(gameSlug)}/chat/channels/${encodePathParam(channelId)}/messages`,
  communityChatRead: (gameSlug: any, channelId: any) =>
    `/games/${encodePathParam(gameSlug)}/chat/channels/${encodePathParam(channelId)}/read`,
  communityChatMessage: (gameSlug: any, messageId: any) =>
    `/games/${encodePathParam(gameSlug)}/chat/messages/${encodePathParam(messageId)}`,
  communityChatReactions: (gameSlug: any, messageId: any) =>
    `/games/${encodePathParam(gameSlug)}/chat/messages/${encodePathParam(messageId)}/reactions`,
  chatAcceptRequest: (conversationId: any) => `/chat/requests/${encodePathParam(conversationId)}/accept`,
  chatDeclineRequest: (conversationId: any) =>
    `/chat/requests/${encodePathParam(conversationId)}/decline`,
  chatBlockedUsers: '/chat/users/blocked',
  chatUserBlock: (userId: any) => `/chat/users/${encodePathParam(userId)}/block`,
  chatBlockConversation: (conversationId: any) =>
    `/chat/conversations/${encodePathParam(conversationId)}/block`,
  chatConversation: (conversationId: string) =>
    `/chat/conversations/${encodePathParam(conversationId)}`,
  chatArchiveConversation: (conversationId: string) =>
    `/chat/conversations/${encodePathParam(conversationId)}/archive`,
  chatNotificationLevel: (conversationId: string) =>
    `/chat/conversations/${encodePathParam(conversationId)}/notification-level`,
  chatGroups: '/chat/groups',
  chatGroup: (conversationId: any) => `/chat/groups/${encodePathParam(conversationId)}`,
  chatGroupPhoto: (conversationId: any) => `/chat/groups/${encodePathParam(conversationId)}/photo`,
  chatGroupMembers: (conversationId: any) =>
    `/chat/groups/${encodePathParam(conversationId)}/members`,
  chatGroupTransferOwnership: (conversationId: any) =>
    `/chat/groups/${encodePathParam(conversationId)}/transfer-ownership`,
  chatGroupMemberRole: (conversationId: any, userId: any) =>
    `/chat/groups/${encodePathParam(conversationId)}/members/${encodePathParam(userId)}/role`,
  chatGroupLeave: (conversationId: string) =>
    `/chat/groups/${encodePathParam(conversationId)}/leave`,
  chatDelivered: '/chat/messages/delivered',
  linkPreviews: '/link-previews',
  chatRead: (conversationId: any) => `/chat/conversations/${encodePathParam(conversationId)}/read`,
  presence: '/presence',
  presenceMe: '/presence/me',
  chatBackup: '/chat-backup',
  chatBackupBlobs: '/chat-backup/blobs',
  chatBackupChallenge: '/chat-backup/challenge',
  chatBackupSchedule: '/chat-backup/schedule',
  chatDevices: '/chat-devices',
  chatDeviceKeyPackages: (deviceId: any) => `/chat-devices/${encodePathParam(deviceId)}/key-packages`,
  chatDeviceKeyPackageStatus: (deviceId: any) =>
    `/chat-devices/${encodePathParam(deviceId)}/key-packages/status`,
  chatDevice: (deviceId: any) => `/chat-devices/${encodePathParam(deviceId)}`,
  chatDeviceSignOut: (deviceId: any) => `/chat-devices/${encodePathParam(deviceId)}/sign-out`,
  chatDeviceSession: (deviceId: any) => `/chat-devices/${encodePathParam(deviceId)}/session`,
  chatDeviceSessionChallenge: (deviceId: any) =>
    `/chat-devices/${encodePathParam(deviceId)}/session/challenge`,
  chatDeviceClaim: (userId: any, query: any) =>
    withQuery(`/chat-devices/claim/${encodePathParam(userId)}`, query),
  mlsHandshakes: (conversationId: any) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}`,
  mlsPendingWelcomes: (deviceId: any) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/welcomes`,
  mlsFaults: (conversationId: any) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/faults`,
  mlsMembershipWork: (deviceId: any) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/membership-work`,
  mlsExternalJoin: (conversationId: any) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/external-join`,
  mlsGroupInfo: (conversationId: any) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/group-info`,
  mlsPending: (deviceId: any) => `/mls-handshakes/devices/${encodePathParam(deviceId)}/pending`,
  mlsJoinable: (deviceId: any) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/joinable-conversations`,
  mlsRoster: (conversationId: any) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/roster`,
  mlsReleaseMembershipWork: (deviceId: any, conversationId: any) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/membership-work/${encodePathParam(conversationId)}/release`,
  mlsConsumeWelcome: (deviceId: any, welcomeId: any) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/welcomes/${encodePathParam(welcomeId)}/consume`,
  devTestUsers: "/dev/test-users",
  devTestUser: (id: any) => `/dev/test-users/${encodePathParam(id)}`,
  devTestUserImpersonate: (id: any) => `/dev/test-users/${encodePathParam(id)}/impersonate`,
};
function encodePathParam(value: any) {
  return encodeURIComponent(String(value || ""));
}
function decodePathParam(value: any) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}
export function communitySymbol(name: any = "") {
  const lower = name.toLowerCase();
  if (lower.includes("wuthering")) return "\u263e";
  if (lower.includes("honkai")) return "\u2727";
  if (lower.includes("genshin")) return "\u2726";
  if (lower.includes("zenless")) return "Z";
  if (lower.includes("gray") || lower.includes("raven")) return "\u25c7";
  return name.trim().charAt(0).toUpperCase() || "\u2726";
}
export function formatCount(value: any) {
  const number = Number(value || 0);
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return String(number);
}
export function normalizeGame(game: any) {
  if (game.raw) return game;
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
export function normalizePost(post: any) {
  const createdAt = post.createdAt ? new Date(post.createdAt) : null;
  const elapsed =
    createdAt && !Number.isNaN(createdAt.valueOf()) ? Date.now() - createdAt.valueOf() : null;
  const hours = elapsed === null ? null : Math.max(1, Math.floor(elapsed / 3600000));
  const time =
    hours === null ? "Recently" : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  return {
    id: post.id,
    title: post.title || post.content?.slice(0, 100) || "Post",
    author: post.author?.name || "Unknown user",
    authorId: post.author?.id || post.authorId,
    authorImage: post.author?.image || null,
    time,
    tag: post.category?.name || post.tags?.[0]?.name || "Discussion",
    gameName: post.game?.name,
    gameSlug: post.game?.slug,
    content: post.content || "",
    media: Array.isArray(post.media) ? post.media : [],
    visibility: post.visibility || "PUBLIC",
    isSpoiler: Boolean(post.isSpoiler),
    type: post.type ?? null,
    likeCount: post.reactionCount ?? post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    likedByCurrentUser: Boolean(post.likedByCurrentUser),
    raw: post,
  };
}
function normalizePostResponse(post: any) {
  return post.raw ? post : normalizePost(post);
}
export function fallbackGames(search: any = "") {
  const query = search.trim().toLowerCase();
  const items = query
    ? mockGames.filter((game: any) =>
        `${game.name} ${game.slug} ${game.description}`.toLowerCase().includes(query),
      )
    : mockGames;
  return {
    items: items.map(normalizeGame),
    meta: { total: items.length, source: "local" },
  };
}
export function fallbackGame(slug: any) {
  const game = mockGames.find((item: any) => item.slug === slug || item.id === slug);
  return game ? normalizeGame(game) : null;
}
export function fallbackPosts({ gameSlug, search = "" }: any = {}) {
  const query = search.trim().toLowerCase();
  return posts
    .filter((post: any) => {
      const matchesGame = gameSlug ? post.gameSlug === gameSlug : true;
      const game = mockGames.find((item: any) => item.slug === post.gameSlug);
      const matchesSearch = query
        ? `${post.title} ${post.author} ${post.tag} ${game?.name || ""}`
            .toLowerCase()
            .includes(query)
        : true;
      return matchesGame && matchesSearch;
    })
    .map((post: any) => {
      const game = mockGames.find((item: any) => item.slug === post.gameSlug);
      return {
        ...post,
        gameName: game?.name || post.gameSlug,
        gameSymbol: game ? communitySymbol(game.name) : communitySymbol(post.gameSlug),
        raw: post,
      };
    });
}
export function fallbackCategories() {
  return mockCategories;
}
function withQuery(path: any, query: any = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]: any) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });
  return `${path}${params.toString() ? `?${params}` : ""}`;
}
const REQUEST_TIMEOUT_MS = 15000;
async function request(path: any, options: any = {}) {
  const { headers, body, allowUnauthorized = false, ...fetchOptions } = options;
  if (USE_MOCKS) return mockResponse(path, options);
  const shouldSendJsonHeader = body !== undefined && !(body instanceof FormData);
  // Uploads can be slow; everything else gets a deadline, because callers such as the MLS sync hold a lock while waiting.
  const timeout =
    body instanceof FormData ? {} : { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      ...(shouldSendJsonHeader ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
    ...timeout,
    ...fetchOptions,
  });
  if (allowUnauthorized && response.status === 401) return null;
  if (!response.ok) {
    let message;
    let code;
    try {
      const errorBody = await response.json();
      message = errorBody.message || errorBody.error || JSON.stringify(errorBody);
      code = typeof errorBody.code === "string" ? errorBody.code : undefined;
    } catch {
      message = await response.text().catch(() => "");
    }
    const error: ApiError = new Error(
      response.status >= 500
        ? 'Something went wrong. Please try again.'
        : message || `API request failed: ${response.status}`,
    );
    error.status = response.status;
    // Machine-readable reason from the backend (e.g. MEMBERSHIP_CHANGE_PENDING), when it sent one.
    error.code = response.status >= 500 ? undefined : code;
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
      error.retryAfterSeconds = retryAfterSeconds > 0 ? retryAfterSeconds : undefined;
    }
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
/** Submits an MLS handshake, returning a 409 as a structured { outcome: 'conflict', handshake } instead of throwing. */
async function submitMlsCommit(path: any, payload: any) {
  if (USE_MOCKS) return mutation(path, payload);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 409 && body?.outcome === "conflict") {
    return body;
  }
  if (!response.ok) {
    const error: ApiError = new Error(body?.message || `API request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}
function mutation(path: any, payload: any = undefined, options: any = {}) {
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
function mutationAuthHeaders(headers: any) {
  return headers || {};
}
const mockJoinedGames = new Set();
async function mockResponse(path: any, options: any = {}) {
  await new Promise((resolve: any) => setTimeout(resolve, 120));
  const [pathname, queryString] = path.split("?");
  const params = new URLSearchParams(queryString || "");
  if (pathname === backendRoutes.health) return { status: "ok" };
  if (pathname === backendRoutes.currentUser)
    return ADMIN_PREVIEW
      ? {
          id: "admin-preview",
          name: "Admin Preview",
          email: "preview@localhost",
          role: "ADMIN",
          status: "ACTIVE",
        }
      : null;
  if (pathname === backendRoutes.userSearch) return { items: [] };
  if (pathname === backendRoutes.signInEmail || pathname === backendRoutes.signUpEmail)
    return { ok: true };
  if (pathname === backendRoutes.myPosts) {
    const items = fallbackPosts();
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (
    pathname === backendRoutes.latestFeed ||
    pathname === backendRoutes.trendingFeed ||
    pathname === backendRoutes.forYouFeed
  ) {
    const items = params.has("cursor") ? [] : fallbackPosts();
    return {
      items,
      meta: {
        limit: Number(params.get("limit") || 20),
        hasMore: false,
        nextCursor: null,
        ...(pathname === backendRoutes.forYouFeed ? { personalized: false } : {}),
      },
    };
  }
  if (pathname === backendRoutes.posts && options.method === "POST") {
    return { id: `mock-post-${Date.now()}`, ...JSON.parse(options.body || "{}") };
  }
  if (pathname === backendRoutes.posts) {
    const items = fallbackPosts({ search: params.get("search") || "" });
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (/^\/posts\/[^/]+$/.test(pathname)) {
    const postId = decodePathParam(pathname.split("/")[2]);
    const post = fallbackPosts().find((item: any) => item.id === postId);
    if (!post) throw new Error("Post not found");
    return post;
  }
  if (/^\/posts\/[^/]+\/comments$/.test(pathname)) {
    return { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  }
  if (/^\/comments\/[^/]+\/replies$/.test(pathname)) {
    return { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  }
  if (/^\/users\/[^/]+\/follow-status$/.test(pathname)) return { following: false };
  if (pathname === backendRoutes.signOut) {
    mockJoinedGames.clear();
    return { ok: true };
  }
  if (pathname === backendRoutes.gamesJoined)
    return { items: mockGames.filter((game: any) => mockJoinedGames.has(game.slug)) };
  if (/^\/games\/[^/]+\/(join|join-status)$/.test(pathname)) {
    const slug = decodePathParam(pathname.split("/")[2]);
    if (pathname.endsWith("/join")) {
      if (options.method === "DELETE") mockJoinedGames.delete(slug);
      else mockJoinedGames.add(slug);
    }
    return { joined: mockJoinedGames.has(slug) };
  }
  if (pathname === backendRoutes.games) return fallbackGames(params.get("search") || "");
  if (/^\/games\/[^/]+\/moderators\/[^/]+$/.test(pathname) && options.method === "DELETE")
    return { message: "Moderator removed successfully" };
  if (/^\/games\/[^/]+\/moderators$/.test(pathname)) {
    if (options.method === "POST") {
      const target = JSON.parse(options.body || "{}");
      return {
        id: `mock-moderator-${Date.now()}`,
        user: {
          id: target.userId || "mock-user",
          name: "Preview Moderator",
          email: target.email || "moderator@example.com",
          status: "ACTIVE",
        },
      };
    }
    return [];
  }
  if (pathname.startsWith("/games/") && pathname.endsWith("/categories"))
    return fallbackCategories();
  if (pathname.startsWith("/games/") && pathname.endsWith("/feed")) {
    const slug = decodePathParam(pathname.split("/")[2]);
    const categorySlug = params.get("categorySlug")?.toLowerCase();
    const items = fallbackPosts({ gameSlug: slug }).filter((post: any) => {
      if (!categorySlug) return true;
      const tag = post.tag.toLowerCase();
      return tag === categorySlug || `${tag}s` === categorySlug;
    });
    return {
      items: params.has("cursor") ? [] : items,
      meta: { limit: Number(params.get("limit") || 20), hasMore: false, nextCursor: null },
    };
  }
  // Moderation requires explicit fixtures; never let the generic game mock impersonate a case.
  if (pathname.startsWith('/moderation/cases') || /^\/games\/[^/]+\/moderation\/cases/.test(pathname)) {
    throw new Error('Case moderation requires a running backend. Disable NEXT_PUBLIC_USE_MOCKS.');
  }
  if (pathname.startsWith('/games/')) {
    const slug = decodePathParam(pathname.split('/')[2]);
    const game = mockGames.find((item: any) => item.slug === slug || item.id === slug);
    if (!game) throw new Error('Game not found');
    return game;
  }
  if (/^\/chat-devices\/[^/]+\/key-packages\/status$/.test(pathname)) {
    return { singleUseRemaining: 10, lastResortExpiresAt: null };
  }
  if (pathname === backendRoutes.chatBackup) {
    if (options.method === "PUT") return { enabled: true };
    if (options.method === "DELETE") return { enabled: false };
    return { enabled: false, keyCheck: null, blobCount: 0, bytesUsed: 0 };
  }
  if (pathname === backendRoutes.chatBackupChallenge) return { nonce: "" };
  if (pathname === backendRoutes.chatBackupSchedule) {
    return { enabled: true, deletionScheduledFor: null };
  }
  if (pathname === backendRoutes.chatBackupBlobs) {
    if (options.method === "POST") return { stored: 0, skipped: 0 };
    return { items: [], nextCursor: null };
  }
  if (pathname === backendRoutes.chatDevices && !options.method) return { items: [] };
  if (pathname.startsWith("/chat")) return [];
  return null;
}
async function uploadToCloudinary(file: any, authorization: any) {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", authorization.apiKey);
  form.append("timestamp", String(authorization.timestamp));
  form.append("signature", authorization.signature);
  form.append("upload_preset", authorization.uploadPreset);
  form.append("folder", authorization.folder);
  form.append("public_id", authorization.publicId);
  form.append("overwrite", "false");
  const response = await fetch(authorization.uploadUrl, { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Cloudinary upload failed");
  return {
    uploadId: authorization.uploadId,
    assetId: result.asset_id,
    publicId: result.public_id,
    secureUrl: result.secure_url,
    version: result.version,
    signature: result.signature,
    format: result.format,
    bytes: result.bytes,
    ...(result.width ? { width: result.width } : {}),
    ...(result.height ? { height: result.height } : {}),
    ...(result.duration !== undefined ? { duration: result.duration } : {}),
  };
}
// Shared signatures -> Cloudinary -> confirm pipeline behind uploadPostMedia and uploadSingleImage.
type UploadFailure = { file?: File; error: string };

async function uploadAndConfirm(
  files: File[],
  purpose: string,
): Promise<{ successful: ConfirmedMediaUpload[]; failed: UploadFailure[] }> {
  if (!files.length) return { successful: [], failed: [] };
  const authorizations = await api.createUploadSignatures(files, purpose);
  const settled = await Promise.allSettled(
    files.map((file: any, index: any) => uploadToCloudinary(file, authorizations.items[index])),
  );
  const uploaded = settled.flatMap((result: any, index: any) =>
    result.status === "fulfilled" ? [{ file: files[index], payload: result.value }] : [],
  );
  const failed = settled.flatMap((result: any, index: any) =>
    result.status === "rejected"
      ? [{ file: files[index], error: result.reason?.message || "Upload failed" }]
      : [],
  );
  if (!uploaded.length) return { successful: [], failed };
  const confirmed = await api.confirmMediaUploads(uploaded.map(({ payload }: any) => payload));
  const confirmedById = new Map(
    confirmed.successful.map(({ uploadId, result }: any) => [uploadId, result]),
  );
  const uploadedFileById = new Map(
    uploaded.map(({ file, payload }: any) => [payload.uploadId, file]),
  );
  const confirmationErrors = new Map(
    confirmed.failed.map(({ uploadId, error }: any) => [uploadId, error]),
  );
  return {
    successful: uploaded.flatMap(({ payload }: any) => {
      const result = confirmedById.get(payload.uploadId);
      const file = uploadedFileById.get(payload.uploadId);
      return result
        ? [{ ...(result as ConfirmedMediaUpload), fileName: file?.name || "Uploaded media" }]
        : [];
    }),
    failed: [
      ...failed,
      ...uploaded.flatMap(({ file, payload }: any) => {
        const error = confirmationErrors.get(payload.uploadId);
        return error ? [{ file, error: String(error) }] : [];
      }),
    ],
  };
}
function encryptedMessagePayload({
  ciphertext,
  encryptionMeta,
  contentType = "TEXT",
  clientMessageId,
  replyToId,
  media,
  mentionUserIds,
}: any) {
  return {
    ciphertext,
    ...(encryptionMeta ? { encryptionMeta } : {}),
    ...(contentType ? { contentType } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(replyToId ? { replyToId } : {}),
    ...(mentionUserIds?.length ? { mentionUserIds } : {}),
    ...(media?.length ? { media } : {}),
  };
}
const MEDIA_BATCH_SIZE = 10;
function chunked(items: any) {
  const chunks = [];
  for (let i = 0; i < items.length; i += MEDIA_BATCH_SIZE) {
    chunks.push(items.slice(i, i + MEDIA_BATCH_SIZE));
  }
  return chunks;
}
export const api = {
  baseUrl: API_BASE_URL,
  usingMocks: USE_MOCKS,
  getHealth: () => request(backendRoutes.health),
  getGames: async (query: any = {}, options: any = {}) => {
    const response = await request(withQuery(backendRoutes.games, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizeGame),
      meta: response.meta || { total: items.length },
    };
  },
  /** Reads server-backed membership for the authenticated session. */
  getGameJoinStatus: (slug: any, options: any = {}) =>
    request(backendRoutes.gameJoinStatus(slug), options),
  /** Idempotently joins the game as the authenticated session user. */
  joinGame: (slug: any) => mutation(backendRoutes.gameJoin(slug)),
  /** Idempotently leaves the game as the authenticated session user. */
  leaveGame: (slug: any) => mutation(backendRoutes.gameJoin(slug), undefined, { method: "DELETE" }),
  /** Lists the session user's joined games using normal community shapes. */
  getJoinedGames: async (options: any = {}) => {
    const response = await request(backendRoutes.gamesJoined, options);
    return { items: (response.items || []).map(normalizeGame) };
  },
  getCommunity: async (slug: any) => normalizeGame(await request(backendRoutes.game(slug))),
  getCategories: (gameSlug: any, query: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.gameCategories(gameSlug), query), options),
  createCategory: (gameSlug: any, category: any) =>
    mutation(backendRoutes.gameCategories(gameSlug), category),
  updateCategory: (categoryId: any, updates: any) =>
    mutation(`/game-categories/${encodePathParam(categoryId)}`, updates, { method: "PATCH" }),
  getGameModerators: (gameSlug: any, options: any = {}) =>
    request(backendRoutes.gameModerators(gameSlug), options),
  searchGameModeratorCandidates: (gameSlug: any, q: any, options: any = {}) => request(withQuery(`${backendRoutes.gameModerators(gameSlug)}/candidates`, { q }), options),
  assignGameModerator: (gameSlug: any, target: any) =>
    mutation(backendRoutes.gameModerators(gameSlug), target),
  removeGameModerator: (gameSlug: any, userId: any) =>
    mutation(backendRoutes.gameModerator(gameSlug, userId), undefined, { method: "DELETE" }),
  createGame: (game: any) => mutation(backendRoutes.games, game),
  updateGame: (gameId: any, updates: any) =>
    mutation(backendRoutes.game(gameId), updates, { method: "PATCH" }),
  // Moderator or admin of this specific game. Requires an already-confirmed
  // upload id from uploadSingleImage, not a raw URL.
  updateGameBranding: (gameSlug: any, { iconMediaUploadId, bannerMediaUploadId }: any = {}) =>
    mutation(
      backendRoutes.gameBranding(gameSlug),
      { iconMediaUploadId, bannerMediaUploadId },
      { method: "PATCH" },
    ),
  // Admin only - soft-deletes/restores the game community.
  archiveGame: (gameSlug: any) =>
    mutation(backendRoutes.gameArchive(gameSlug), undefined, { method: "PATCH" }),
  restoreGame: (gameSlug: any) =>
    mutation(backendRoutes.gameRestore(gameSlug), undefined, { method: "PATCH" }),
  // Moderator or admin - no state change, just an audit entry for an admin to review.
  flagGameForReview: (gameSlug: any, reason: any) =>
    mutation(backendRoutes.gameFlag(gameSlug), { reason }),
  // The current user's own moderated games - backs the standalone /moderator page.
  listModeratedGames: (options: any = {}) => request(backendRoutes.gamesModerated, options),
  getCurrentUser: (options: any = {}) =>
    request(backendRoutes.currentUser, { ...options, allowUnauthorized: true }),
  getProfile: (options: any = {}) => api.getCurrentUser(options),
  // One-time claim - the backend 409s if this account already completed onboarding.
  completeOnboarding: ({ name, username }: any) =>
    mutation(backendRoutes.completeOnboarding, { name, username }, { method: "PATCH" }),
  // Needs an already-confirmed AVATAR upload id from uploadSingleImage; every call below returns the updated /users/me shape.
  updateAvatar: (avatarMediaUploadId: any) =>
    mutation(backendRoutes.userAvatar, { avatarMediaUploadId }, { method: "PATCH" }),
  removeAvatar: () => mutation(backendRoutes.userAvatar, undefined, { method: "DELETE" }),
  getBannerOptions: (options: any = {}) => request(backendRoutes.userBannerOptions, options),
  updateBanner: (bannerPresetId: any) =>
    mutation(backendRoutes.userBanner, { bannerPresetId }, { method: "PATCH" }),
  removeBanner: () => mutation(backendRoutes.userBanner, undefined, { method: "DELETE" }),
  checkUsernameAvailable: (username: any, options: any = {}) =>
    request(withQuery(backendRoutes.usernameAvailable, { username }), options),
  /** @param {{ limit?: number, signal?: AbortSignal }} [options] */
  searchUsers: (
    q: any,
    /** @type {{ limit?: number, signal?: AbortSignal }} */ options: any = {},
  ) =>
    request(withQuery(backendRoutes.userSearch, { q, limit: options.limit ?? 8 }), {
      signal: options.signal,
    }),
  signIn: ({ email, password }: any) =>
    mutation(backendRoutes.signInEmail, {
      email,
      password,
    }),
  signUp: ({ name, email, password }: any) =>
    mutation(backendRoutes.signUpEmail, {
      name,
      email,
      password,
    }),
  signOut: () => mutation(backendRoutes.signOut),
  getMyPosts: async (query: any = {}, options: any = {}) => {
    const response = await request(withQuery(backendRoutes.myPosts, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizePostResponse),
      meta: response.meta || { total: items.length },
    };
  },
  getLatestFeed: (query: any = {}, options: any = {}) =>
    api.getFeedCollection(backendRoutes.latestFeed, query, options),
  getForYouFeed: (query: any = {}, options: any = {}) =>
    api.getFeedCollection(backendRoutes.forYouFeed, query, options),
  getTrendingFeed: (query: any = {}, options: any = {}) =>
    api.getFeedCollection(backendRoutes.trendingFeed, query, options),
  getPosts: (query: any = {}, options: any = {}) =>
    api.getPostCollection(backendRoutes.posts, query, options),
  getPost: async (postId: any, options: any = {}) => {
    const post = await request(backendRoutes.post(postId), options);
    return normalizePostResponse(post);
  },
  getGameFeed: (gameSlug: any, query: any = {}, options: any = {}) =>
    api.getFeedCollection(backendRoutes.gameFeed(gameSlug), query, options),
  likePost: (postId: any) => mutation(backendRoutes.postLike(postId)),
  likeComment: (commentId: string) => mutation(backendRoutes.commentLike(commentId)),
  unlikeComment: (commentId: string) =>
    mutation(backendRoutes.commentLike(commentId), undefined, { method: "DELETE" }),
  getWallet: (options: any = {}) => request(backendRoutes.wallet, options),
  getWalletLedger: (options: any = {}) => request(backendRoutes.walletLedger, options),
  checkIn: () => mutation(backendRoutes.walletCheckIn),
  deletePost: (postId: string) =>
    mutation(backendRoutes.post(postId), undefined, { method: "DELETE" }),
  unlikePost: (postId: any) =>
    mutation(backendRoutes.postLike(postId), undefined, { method: "DELETE" }),
  getFollowStatus: (userId: any, options: any = {}) =>
    request(backendRoutes.followStatus(userId), options),
  followUser: (userId: any) => mutation(backendRoutes.userFollow(userId)),
  unfollowUser: (userId: any) =>
    mutation(backendRoutes.userFollow(userId), undefined, { method: "DELETE" }),
  getComments: (postId: any, query: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.postComments(postId), query), options),
  createComment: (postId: any, content: any) =>
    mutation(backendRoutes.postComments(postId), { content }),
  getReplies: (commentId: any, query: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.commentReplies(commentId), query), options),
  createReply: (commentId: any, content: any) =>
    mutation(backendRoutes.commentReplies(commentId), { content }),
  createReport: (report: any) => mutation(backendRoutes.reports, report),
  createPost: (post: any) => mutation(backendRoutes.posts, post),
  createUploadSignatures: (files: any, purpose: any = "POST") =>
    mutation(backendRoutes.mediaSignatures, {
      purpose,
      items: files.map((file: any) => ({
        resourceType: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      })),
    }),
  confirmMediaUploads: (items: any) => mutation(backendRoutes.mediaConfirm, { items }),
  uploadPostMedia: (files: any) => uploadAndConfirm(files, "POST"),
  // Uploads one image for a non-post purpose (e.g. GAME_ICON, GAME_BANNER), returning its confirmed { mediaUploadId, secureUrl, ... }.
  uploadSingleImage: async (file: File, purpose: string): Promise<ConfirmedMediaUpload> => {
    const { successful, failed } = await uploadAndConfirm([file], purpose);
    if (!successful.length) {
      throw new Error(failed[0]?.error || "Upload failed");
    }
    return successful[0]!;
  },
  /**
   * Uploads already-encrypted bytes as opaque raw blobs, returning upload ids in input order.
   * @param {{ bytes: Uint8Array, kind: "BLOB" | "THUMB" }[]} blobs
   */
  uploadChatBlobs: async (blobs: any) => {
    const uploaded = [];
    for (const batch of chunked(blobs)) {
      const authorizations = await mutation(backendRoutes.mediaSignatures, {
        purpose: "CHAT",
        items: batch.map(({ kind }: any) => ({ opaqueKind: kind })),
      });
      const results = [];
      for (const [index, { bytes }] of batch.entries()) {
        const file = new Blob([bytes], { type: "application/octet-stream" });
        results.push(await uploadToCloudinary(file, authorizations.items[index]));
      }
      const confirmed = await api.confirmMediaUploads(results);
      if (confirmed.failedCount) {
        throw new Error(confirmed.failed?.[0]?.error || "Media confirmation failed");
      }
      const byId = new Map<any, any>(
        confirmed.successful.map(({ uploadId, result }: any) => [uploadId, result]),
      );
      uploaded.push(...results.map(({ uploadId }: any) => byId.get(uploadId)?.mediaUploadId));
    }
    return uploaded;
  },
  /** @returns {Promise<import("./feedTypes").FeedResponse<ReturnType<typeof normalizePostResponse>>>} */
  getFeedCollection: async (
    path: any,
    { limit = 20, cursor, type, sort, categorySlug }: any = {},
    options: any = {},
  ) => {
    const response = await request(
      withQuery(path, { limit, cursor, type, sort, categorySlug }),
      options,
    );
    return { items: (response.items || []).map(normalizePostResponse), meta: response.meta };
  },
  getPostCollection: async (path: any, query: any = {}, options: any = {}) => {
    const response = await request(withQuery(path, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizePostResponse),
      meta: response.meta || { total: items.length },
    };
  },
  getHome: async ({ search = "" }: any = {}) => {
    const [games, latest, trending] = await Promise.all([
      api.getGames({ status: "ACTIVE", search, limit: 20 }),
      api.getLatestFeed({ limit: 10 }),
      api.getTrendingFeed({ limit: 10 }),
    ]);
    return {
      communities: games.items,
      forYouPosts: latest.items,
      posts: trending.items,
      meta: games.meta,
      latestMeta: latest.meta,
      trendingMeta: trending.meta,
    };
  },
  getAdminOverview: (options: any = {}) => request(backendRoutes.adminOverview, options),
  searchPlatformModeratorCandidates: (q: any, options: any = {}) => request(withQuery('/platform-moderators/candidates', { q }), options),
  grantPlatformModerator: (userId: any) => mutation(`/platform-moderators/${encodeURIComponent(userId)}`, undefined),
  revokePlatformModerator: (userId: any) => mutation(`/platform-moderators/${encodeURIComponent(userId)}`, undefined, { method: 'DELETE' }),
  listPlatformCases: ({ cursor, limit, status, targetType, scope, gameSlug, view }: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.platformCases, { cursor, limit, status, targetType, scope, gameSlug, view }), options),
  getPlatformCase: (caseId: any, options: any = {}) => request(backendRoutes.platformCase(caseId), options),
  listPlatformCaseReports: (caseId: any, { cursor, limit }: any = {}, options: any = {}) =>
    request(withQuery(`${backendRoutes.platformCase(caseId)}/reports`, { cursor, limit }), options),
  searchPlatformCaseAssignees: (caseId: any, q: any, options: any = {}) => request(withQuery(`${backendRoutes.platformCase(caseId)}/assignees`, { q }), options),
  assignPlatformCase: (caseId: any, { assigneeId }: any) => mutation(`${backendRoutes.platformCase(caseId)}/assignee`, { assigneeId }, { method: "PATCH" }),
  claimPlatformCase: (caseId: any) => mutation(`${backendRoutes.platformCase(caseId)}/claim`, undefined, { method: "PATCH" }),
  resolvePlatformCase: (caseId: any, { resolutionNote }: any = {}) => mutation(`${backendRoutes.platformCase(caseId)}/resolve`, { resolutionNote }, { method: "PATCH" }),
  dismissPlatformCase: (caseId: any, { resolutionNote }: any = {}) => mutation(`${backendRoutes.platformCase(caseId)}/dismiss`, { resolutionNote }, { method: "PATCH" }),
  listGameCases: (gameSlug: any, { cursor, limit, status, targetType, view }: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.gameCases(gameSlug), { cursor, limit, status, targetType, view }), options),
  getGameCase: (gameSlug: any, caseId: any, options: any = {}) => request(backendRoutes.gameCase(gameSlug, caseId), options),
  listGameCaseReports: (gameSlug: any, caseId: any, { cursor, limit }: any = {}, options: any = {}) =>
    request(withQuery(`${backendRoutes.gameCase(gameSlug, caseId)}/reports`, { cursor, limit }), options),
  searchGameCaseAssignees: (gameSlug: any, caseId: any, q: any, options: any = {}) => request(withQuery(`${backendRoutes.gameCase(gameSlug, caseId)}/assignees`, { q }), options),
  assignGameCase: (gameSlug: any, caseId: any, { assigneeId }: any) => mutation(`${backendRoutes.gameCase(gameSlug, caseId)}/assignee`, { assigneeId }, { method: "PATCH" }),
  claimGameCase: (gameSlug: any, caseId: any) => mutation(`${backendRoutes.gameCase(gameSlug, caseId)}/claim`, undefined, { method: "PATCH" }),
  resolveGameCase: (gameSlug: any, caseId: any, { resolutionNote }: any = {}) => mutation(`${backendRoutes.gameCase(gameSlug, caseId)}/resolve`, { resolutionNote }, { method: "PATCH" }),
  dismissGameCase: (gameSlug: any, caseId: any, { resolutionNote }: any = {}) => mutation(`${backendRoutes.gameCase(gameSlug, caseId)}/dismiss`, { resolutionNote }, { method: "PATCH" }),
  listAdminUsers: (query: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.adminUsers, query), options),
  setUserStatus: (userId: any, { status, reason }: any) =>
    mutation(backendRoutes.adminUserStatus(userId), { status, reason }, { method: "PATCH" }),
  listAdminContent: (query: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.adminContent, query), options),
  hideContent: (item: any) =>
    mutation(
      item.type === "POST"
        ? item.gameSlug
          ? backendRoutes.postHide(item.gameSlug, item.id)
          : `/admin/posts/${encodePathParam(item.id)}/hide`
        : item.gameSlug
          ? backendRoutes.commentHide(item.gameSlug, item.id)
          : `/admin/comments/${encodePathParam(item.id)}/hide`,
      undefined,
      { method: "PATCH" },
    ),
  restoreContent: (item: any) =>
    mutation(
      item.type === "POST"
        ? item.gameSlug
          ? backendRoutes.postRestore(item.gameSlug, item.id)
          : `/admin/posts/${encodePathParam(item.id)}/restore`
        : item.gameSlug
          ? backendRoutes.commentRestore(item.gameSlug, item.id)
          : `/admin/comments/${encodePathParam(item.id)}/restore`,
      undefined,
      { method: "PATCH" },
    ),
  // One inbox page: `limit` newest, after `beforeUpdatedAt`/`beforeId` when given (pinned ones come on the first).
  getChatConversations: (page: any = {}) => request(withQuery(backendRoutes.chatConversations, page)),
  getArchivedChatConversations: () => request(backendRoutes.chatArchivedConversations),
  /** @param {{ limit?: number, cursor?: string }} [query] @param {{ signal?: AbortSignal }} [options] */
  getNotifications: (query: any = {}, options: any = {}) =>
    request(withQuery(backendRoutes.notifications, query), { signal: options.signal }),
  getNotificationUnreadCount: ({ signal }: any = {}) =>
    request(backendRoutes.notificationsUnreadCount, { signal }),
  markNotificationRead: (notificationId: any) =>
    mutation(backendRoutes.notificationRead(notificationId), undefined, { method: "PATCH" }),
  markAllNotificationsRead: () =>
    mutation(backendRoutes.notificationsReadAll, undefined, { method: "PATCH" }),
  getChatRequests: () => request(backendRoutes.chatRequests),
  getChatMessages: (conversationId: any, query: any = {}) =>
    request(withQuery(backendRoutes.chatMessages(conversationId), query)),
  createDirectMessage: ({ recipientUserId, message }: any) =>
    mutation(backendRoutes.chatDirect, {
      recipientUserId,
      message: encryptedMessagePayload(message),
    }),
  sendChatMessage: (conversationId: any, message: any) =>
    mutation(backendRoutes.chatMessages(conversationId), {
      message: encryptedMessagePayload(message),
    }),
  acceptChatRequest: (conversationId: any) =>
    mutation(backendRoutes.chatAcceptRequest(conversationId)),
  declineChatRequest: (conversationId: any) =>
    mutation(backendRoutes.chatDeclineRequest(conversationId)),
  getBlockedChatUsers: (options: any = {}) => request(backendRoutes.chatBlockedUsers, options),
  unblockChatUser: (userId: any) =>
    mutation(backendRoutes.chatUserBlock(userId), undefined, { method: 'DELETE' }),
  blockChatConversation: (conversationId: any) =>
    mutation(backendRoutes.chatBlockConversation(conversationId)),
  archiveChatConversation: (conversationId: string) =>
    mutation(backendRoutes.chatArchiveConversation(conversationId)),
  unarchiveChatConversation: (conversationId: string) =>
    mutation(backendRoutes.chatArchiveConversation(conversationId), undefined, {
      method: "DELETE",
    }),
  // Removes the chat for you only; the other people keep theirs.
  deleteChatConversation: (conversationId: string) =>
    mutation(backendRoutes.chatConversation(conversationId), undefined, { method: "DELETE" }),
  /** `notificationLevel` is ALL or NOTHING (muted); `mutedUntil` is an ISO time, omitted for an open-ended mute. */
  setChatNotificationLevel: (conversationId: any, { notificationLevel, mutedUntil }: any) =>
    mutation(
      backendRoutes.chatNotificationLevel(conversationId),
      { notificationLevel, mutedUntil },
      { method: "PATCH" },
    ),
  createGroupChat: ({ title, memberUserIds }: any) =>
    mutation(backendRoutes.chatGroups, { title, memberUserIds }),
  updateGroupChat: (conversationId: any, { title }: any) =>
    mutation(backendRoutes.chatGroup(conversationId), { title }, { method: 'PATCH' }),
  setGroupPhoto: (conversationId: any, photoMediaUploadId: any) =>
    mutation(backendRoutes.chatGroupPhoto(conversationId), { photoMediaUploadId }, { method: 'PATCH' }),
  removeGroupPhoto: (conversationId: any) =>
    mutation(backendRoutes.chatGroupPhoto(conversationId), undefined, { method: 'DELETE' }),
  addGroupMembers: (conversationId: any, userIds: any) =>
    mutation(backendRoutes.chatGroupMembers(conversationId), { userIds }),
  removeGroupMembers: (conversationId: any, userIds: any) =>
    mutation(backendRoutes.chatGroupMembers(conversationId), { userIds }, { method: "DELETE" }),
  transferGroupOwnership: (conversationId: any, newOwnerUserId: any) =>
    mutation(backendRoutes.chatGroupTransferOwnership(conversationId), { newOwnerUserId }),
  updateGroupMemberRole: (conversationId: string, userId: string, role: string) =>
    mutation(
      backendRoutes.chatGroupMemberRole(conversationId, userId),
      { role },
      { method: "PATCH" },
    ),
  leaveGroup: (conversationId: string) => mutation(backendRoutes.chatGroupLeave(conversationId)),
  markChatDelivered: (messageIds: string[]) =>
    mutation(backendRoutes.chatDelivered, { messageIds }),
  // The server fetches the page; the sender attaches the result to the encrypted message.
  fetchLinkPreview: (url: string) => mutation(backendRoutes.linkPreviews, { url }),
  markChatRead: (conversationId: string, lastReadMessageId: string) =>
    mutation(
      backendRoutes.chatRead(conversationId),
      lastReadMessageId ? { lastReadMessageId } : {},
    ),
  // Reactions are plaintext (not part of the encrypted envelope) - one reaction per user per message.
  // `choice` is { kind: 'emoji', emoji } or { kind: 'emote', emote }; the server only needs the id.
  reactToMessage: (messageId: any, choice: any) =>
    mutation(
      backendRoutes.chatMessageReactions(messageId),
      choice.kind === 'emote' ? { emoteId: choice.emote.id } : { emoji: choice.emoji },
    ),
  getChatEmotes: () => request(backendRoutes.chatEmotes),
  // Presence: who is online, and your own choice to appear offline for a while.
  getMyPresence: () => request(backendRoutes.presenceMe),
  /** `status` is ONLINE, or INVISIBLE (shown as Offline) with a `duration` of 15m, 1h, 8h, 24h, 3d or forever. */
  setMyPresence: ({ status, duration }: any) =>
    mutation(backendRoutes.presenceMe, { status, duration }, { method: 'PUT' }),
  /** Online or offline for up to 100 people; anyone the viewer may not see reads as offline. */
  getPresence: (userIds: any) =>
    request(withQuery(backendRoutes.presence, { userIds: userIds.join(',') })),
  // Community chat: public rooms of a game community, plaintext so moderators can read and remove messages.
  getCommunityChannels: (gameSlug: any) => request(backendRoutes.communityChat(gameSlug)),
  /** Members to suggest after an @: whose name or handle starts like `q`. */
  searchCommunityMembers: (gameSlug: any, q: any, /** @type {{ signal?: AbortSignal }} */ options: any = {}) =>
    request(withQuery(backendRoutes.communityChatMembers(gameSlug), { q }), { signal: options.signal }),
  getCommunityMessages: (gameSlug: any, channelId: any, query: any = {}) =>
    request(withQuery(backendRoutes.communityChatMessages(gameSlug, channelId), query)),
  getCommunityMessage: (gameSlug: any, messageId: any) =>
    request(backendRoutes.communityChatMessage(gameSlug, messageId)),
  sendCommunityMessage: (gameSlug: any, channelId: any, message: any) =>
    mutation(backendRoutes.communityChatMessages(gameSlug, channelId), message),
  editCommunityMessage: (gameSlug: any, messageId: any, content: any) =>
    mutation(backendRoutes.communityChatMessage(gameSlug, messageId), { content }, { method: 'PATCH' }),
  removeCommunityMessage: (gameSlug: any, messageId: any, reason: any) =>
    mutation(
      backendRoutes.communityChatMessage(gameSlug, messageId),
      reason ? { reason } : {},
      { method: 'DELETE' },
    ),
  // `choice` is { kind: 'emoji', emoji } or { kind: 'emote', emote }, same as direct messages.
  reactToCommunityMessage: (gameSlug: any, messageId: any, choice: any) =>
    mutation(
      backendRoutes.communityChatReactions(gameSlug, messageId),
      choice.kind === 'emote' ? { emoteId: choice.emote.id } : { emoji: choice.emoji },
    ),
  unreactToCommunityMessage: (gameSlug: any, messageId: any) =>
    mutation(backendRoutes.communityChatReactions(gameSlug, messageId), undefined, { method: 'DELETE' }),
  markCommunityRead: (gameSlug: any, channelId: any, messageId: any) =>
    mutation(backendRoutes.communityChatRead(gameSlug, channelId), messageId ? { messageId } : {}),
  removeReaction: (messageId: any) =>
    mutation(backendRoutes.chatMessageReactions(messageId), undefined, { method: 'DELETE' }),
  // Own message only; soft delete (server clears the ciphertext, the row stays for history).
  /** Changes the signed-in user's settings (for now: sendReadReceipts, messageRequestSetting); answers with the /users/me shape. */
  updateProfile: (changes: any) =>
    mutation(backendRoutes.currentUser, changes, { method: "PATCH" }),
  /** The new text goes as a new encrypted message; `clientMessageId` makes a retry safe. */
  editChatMessage: (messageId: any, { ciphertext, encryptionMeta, clientMessageId }: any) =>
    mutation(backendRoutes.chatMessageEdits(messageId), {
      ciphertext,
      encryptionMeta,
      clientMessageId,
    }),
  deleteChatMessage: (messageId: any) =>
    mutation(backendRoutes.chatMessage(messageId), undefined, { method: "DELETE" }),
  // History backup: { enabled, keyCheck, deletionScheduledFor: ISO | null, blobCount, bytesUsed }. Blobs are opaque base64 ciphertext.
  getChatBackupStatus: () => request(backendRoutes.chatBackup),
  // Turns backup on: { keyCheck, replaceSecret }. Replacing an existing key also needs { replace: true, nonce, proof } and deletes every blob.
  putChatBackupKey: (payload: any) =>
    mutation(backendRoutes.chatBackup, payload, { method: "PUT" }),
  // Single-use nonce for the replace proof: { nonce }.
  getChatBackupChallenge: () => request(backendRoutes.chatBackupChallenge),
  // With { nonce, proof }, turns backup off and deletes every blob now; without, only schedules deletion -> { enabled, deletionScheduledFor }.
  deleteChatBackup: (proof: any = {}) =>
    mutation(backendRoutes.chatBackup, { confirm: true, ...proof }, { method: "DELETE" }),
  // Cancels a scheduled deletion: { nonce, proof } required.
  cancelChatBackupDeletion: (proof: any) =>
    mutation(backendRoutes.chatBackupSchedule, proof, { method: "DELETE" }),
  // items: [{ conversationId, messageId, ciphertext }], up to 100 -> { stored, skipped }.
  uploadChatBackupBlobs: (items: any) => mutation(backendRoutes.chatBackupBlobs, { items }),
  // One page: { items: [{ conversationId, messageId, ciphertext }], nextCursor: string | null }.
  getChatBackupBlobs: ({ after, limit }: any = {}) =>
    request(withQuery(backendRoutes.chatBackupBlobs, { after, limit })),
  registerChatDevice: (payload: any) => mutation(backendRoutes.chatDevices, payload),
  // Your own devices, recently removed ones included: { items: [{ id, ciphersuite, createdAt, lastSeenAt, revokedAt }] }.
  getChatDevices: () => request(backendRoutes.chatDevices),
  uploadChatDeviceKeyPackages: (deviceId: any, payload: any) =>
    mutation(backendRoutes.chatDeviceKeyPackages(deviceId), payload),
  // How many single-use key packages this device has left and when its last-resort one expires.
  getChatDeviceKeyPackageStatus: (deviceId: any) =>
    request(backendRoutes.chatDeviceKeyPackageStatus(deviceId)),
  // Two steps that tell the server this login is in this device's browser, so revoking the device ends
  // the login: get a challenge, then send it back signed with the device key.
  chatDeviceSessionChallenge: (deviceId: any) =>
    mutation(backendRoutes.chatDeviceSessionChallenge(deviceId)),
  linkChatDeviceSession: (deviceId: any, proof: any) =>
    mutation(backendRoutes.chatDeviceSession(deviceId), proof, { method: "PUT" }),
  // Signs a device out of the app everywhere, at once; the device keeps its keys and its groups.
  signOutChatDevice: (deviceId: any) => mutation(backendRoutes.chatDeviceSignOut(deviceId)),
  revokeChatDevice: (deviceId: any) =>
    mutation(backendRoutes.chatDevice(deviceId), undefined, { method: "DELETE" }),
  // One key package per active device of `userId` (an array). Pass excludeDeviceId when claiming your own
  // devices, and conversationId when finishing a change to a group you are in - the server then skips
  // devices already in that group and the DM privacy settings, which no longer apply.
  claimChatDeviceKeyPackages: (
    userId: any,
    { excludeDeviceId, conversationId, deviceIds }: any = {},
  ) =>
    mutation(
      backendRoutes.chatDeviceClaim(userId, {
        excludeDeviceId,
        conversationId,
        deviceIds: deviceIds?.join(","),
      }),
    ),
  submitMlsHandshake: (conversationId: any, payload: any) =>
    submitMlsCommit(backendRoutes.mlsHandshakes(conversationId), payload),
  // A device adds itself to a group with no member online. Answers like submitMlsHandshake, incl. a lost race.
  submitMlsExternalJoin: (conversationId: any, payload: any) =>
    submitMlsCommit(backendRoutes.mlsExternalJoin(conversationId), payload),
  // The public snapshot of a group to join from, for one of your devices.
  getMlsGroupInfo: (conversationId: any, deviceId: any) =>
    request(withQuery(backendRoutes.mlsGroupInfo(conversationId), { deviceId })),
  // One cheap probe: does this device have welcomes, groups to join, or membership work waiting?
  getMlsPendingSummary: (deviceId: any) => request(backendRoutes.mlsPending(deviceId)),
  // Conversations this device could join by itself. scope "full" also finds a new device of an existing member.
  getMlsJoinableConversations: (deviceId: any, { scope }: any = {}) =>
    request(withQuery(backendRoutes.mlsJoinable(deviceId), { scope })),
  getMlsHandshakesSince: (conversationId: any, sinceEpoch: any = 0) =>
    request(withQuery(backendRoutes.mlsHandshakes(conversationId), { sinceEpoch })),
  getMlsPendingWelcomes: (deviceId: any, { after }: any = {}) =>
    request(withQuery(backendRoutes.mlsPendingWelcomes(deviceId), { after })),
  // Membership changes (devices to add or remove) this device can finish, and takes a lease on them.
  // scope "full" also finds new, revoked and leftover devices but costs more; conversationId looks at one conversation only.
  getMlsMembershipWork: (deviceId: any, { scope, after, conversationId }: any = {}) =>
    mutation(
      withQuery(backendRoutes.mlsMembershipWork(deviceId), { scope, after, conversationId }),
    ),
  // Who the server has in the group at an epoch, to check a ratchet tree against.
  getMlsRoster: (conversationId: any, epoch: any) =>
    request(withQuery(backendRoutes.mlsRoster(conversationId), { epoch })),
  // Give the lease back when this device could not finish a conversation's work.
  releaseMlsMembershipWork: (deviceId: any, conversationId: any) =>
    mutation(backendRoutes.mlsReleaseMembershipWork(deviceId, conversationId)),
  // Tell the server this device refused a Commit that did not match what it recorded.
  reportMlsFault: (conversationId: any, payload: any) =>
    mutation(backendRoutes.mlsFaults(conversationId), payload),
  consumeMlsWelcome: (deviceId: any, welcomeId: any) =>
    mutation(backendRoutes.mlsConsumeWelcome(deviceId, welcomeId)),
  // Dev tools only; 404 outside development.
  listDevTestUsers: () => request(backendRoutes.devTestUsers),
  createDevTestUser: (label: any) => mutation(backendRoutes.devTestUsers, label ? { label } : {}),
  impersonateDevTestUser: (id: any) => mutation(backendRoutes.devTestUserImpersonate(id)),
  deleteDevTestUser: (id: any) =>
    mutation(backendRoutes.devTestUser(id), undefined, { method: "DELETE" }),
  deleteAllDevTestUsers: () =>
    mutation(backendRoutes.devTestUsers, undefined, { method: "DELETE" }),
};
