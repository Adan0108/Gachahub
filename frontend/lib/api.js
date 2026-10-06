import { mockCategories, mockGames, posts } from "./mockData";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
// Dev-only: a production build must never be able to fake an admin session or the API layer.
const previewAllowed = process.env.NODE_ENV !== "production";
export const ADMIN_PREVIEW = previewAllowed && process.env.NEXT_PUBLIC_ADMIN_PREVIEW === "true";
export const USE_MOCKS = previewAllowed && process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const backendRoutes = {
  health: '/health',
  games: '/games',
  game: (slug) => `/games/${encodePathParam(slug)}`,
  gameCategories: (gameSlug) => `/games/${encodePathParam(gameSlug)}/categories`,
  gameModerators: (gameSlug) => `/games/${encodePathParam(gameSlug)}/moderators`,
  gameModerator: (gameSlug, userId) =>
    `/games/${encodePathParam(gameSlug)}/moderators/${encodePathParam(userId)}`,
  gamesModerated: '/games/moderated',
  gamesJoined: '/games/joined',
  gameJoin: (slug) => `/games/${encodePathParam(slug)}/join`,
  gameJoinStatus: (slug) => `/games/${encodePathParam(slug)}/join-status`,
  gameBranding: (gameSlug) => `/games/${encodePathParam(gameSlug)}/branding`,
  gameArchive: (gameSlug) => `/games/${encodePathParam(gameSlug)}/archive`,
  gameRestore: (gameSlug) => `/games/${encodePathParam(gameSlug)}/restore`,
  gameFlag: (gameSlug) => `/games/${encodePathParam(gameSlug)}/flag`,
  adminOverview: "/admin/overview",
  adminReports: "/admin/reports",
  reportClaim: (gameSlug, reportId) =>
    `/games/${encodePathParam(gameSlug)}/reports/${encodePathParam(reportId)}/claim`,
  reportResolve: (gameSlug, reportId) =>
    `/games/${encodePathParam(gameSlug)}/reports/${encodePathParam(reportId)}/resolve`,
  reportDismiss: (gameSlug, reportId) =>
    `/games/${encodePathParam(gameSlug)}/reports/${encodePathParam(reportId)}/dismiss`,
  adminUsers: "/admin/users",
  adminUserStatus: (userId) => `/admin/users/${encodePathParam(userId)}/status`,
  adminContent: "/admin/content",
  postHide: (gameSlug, postId) =>
    `/games/${encodePathParam(gameSlug)}/posts/${encodePathParam(postId)}/hide`,
  postRestore: (gameSlug, postId) =>
    `/games/${encodePathParam(gameSlug)}/posts/${encodePathParam(postId)}/restore`,
  commentHide: (gameSlug, commentId) =>
    `/games/${encodePathParam(gameSlug)}/comments/${encodePathParam(commentId)}/hide`,
  commentRestore: (gameSlug, commentId) =>
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
  post: (postId) => `/posts/${encodePathParam(postId)}`,
  latestFeed: "/feed/latest",
  trendingFeed: "/feed/trending",
  forYouFeed: "/feed/for-you",
  gameFeed: (gameSlug) => `/games/${encodePathParam(gameSlug)}/feed`,
  postLike: (postId) => `/posts/${encodePathParam(postId)}/like`,
  userFollow: (userId) => `/users/${encodePathParam(userId)}/follow`,
  followStatus: (userId) => `/users/${encodePathParam(userId)}/follow-status`,
  postComments: (postId) => `/posts/${encodePathParam(postId)}/comments`,
  commentReplies: (commentId) => `/comments/${encodePathParam(commentId)}/replies`,
  reports: "/reports",
  notifications: '/notifications',
  notificationsUnreadCount: '/notifications/unread-count',
  notificationsReadAll: '/notifications/read-all',
  notificationRead: (notificationId) =>
    `/notifications/${encodePathParam(notificationId)}/read`,
  mediaSignatures: '/media/uploads/signatures',
  mediaConfirm: '/media/uploads/confirm',
  chatConversations: '/chat/conversations',
  chatArchivedConversations: '/chat/conversations/archived',
  chatRequests: '/chat/requests',
  chatDirect: '/chat/direct',
  chatMessages: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/messages`,
  chatMessage: (messageId) => `/chat/messages/${encodePathParam(messageId)}`,
  chatMessageEdits: (messageId) => `/chat/messages/${encodePathParam(messageId)}/edits`,
  chatMessageReactions: (messageId) =>
    `/chat/messages/${encodePathParam(messageId)}/reactions`,
  chatAcceptRequest: (conversationId) => `/chat/requests/${encodePathParam(conversationId)}/accept`,
  chatDeclineRequest: (conversationId) =>
    `/chat/requests/${encodePathParam(conversationId)}/decline`,
  chatBlockConversation: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/block`,
  chatNotificationLevel: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/notification-level`,
  chatGroups: '/chat/groups',
  chatGroup: (conversationId) => `/chat/groups/${encodePathParam(conversationId)}`,
  chatGroupMembers: (conversationId) =>
    `/chat/groups/${encodePathParam(conversationId)}/members`,
  chatGroupTransferOwnership: (conversationId) =>
    `/chat/groups/${encodePathParam(conversationId)}/transfer-ownership`,
  chatGroupMemberRole: (conversationId, userId) =>
    `/chat/groups/${encodePathParam(conversationId)}/members/${encodePathParam(userId)}/role`,
  chatGroupLeave: (conversationId) =>
    `/chat/groups/${encodePathParam(conversationId)}/leave`,
  chatDelivered: '/chat/messages/delivered',
  linkPreviews: '/link-previews',
  chatRead: (conversationId) => `/chat/conversations/${encodePathParam(conversationId)}/read`,
  chatBackup: '/chat-backup',
  chatBackupBlobs: '/chat-backup/blobs',
  chatBackupChallenge: '/chat-backup/challenge',
  chatBackupSchedule: '/chat-backup/schedule',
  chatDevices: '/chat-devices',
  chatDeviceKeyPackages: (deviceId) => `/chat-devices/${encodePathParam(deviceId)}/key-packages`,
  chatDeviceKeyPackageStatus: (deviceId) =>
    `/chat-devices/${encodePathParam(deviceId)}/key-packages/status`,
  chatDevice: (deviceId) => `/chat-devices/${encodePathParam(deviceId)}`,
  chatDeviceSignOut: (deviceId) => `/chat-devices/${encodePathParam(deviceId)}/sign-out`,
  chatDeviceSession: (deviceId) => `/chat-devices/${encodePathParam(deviceId)}/session`,
  chatDeviceSessionChallenge: (deviceId) =>
    `/chat-devices/${encodePathParam(deviceId)}/session/challenge`,
  chatDeviceClaim: (userId, query) =>
    withQuery(`/chat-devices/claim/${encodePathParam(userId)}`, query),
  mlsHandshakes: (conversationId) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}`,
  mlsPendingWelcomes: (deviceId) => `/mls-handshakes/devices/${encodePathParam(deviceId)}/welcomes`,
  mlsFaults: (conversationId) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/faults`,
  mlsMembershipWork: (deviceId) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/membership-work`,
  mlsExternalJoin: (conversationId) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/external-join`,
  mlsGroupInfo: (conversationId) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/group-info`,
  mlsPending: (deviceId) => `/mls-handshakes/devices/${encodePathParam(deviceId)}/pending`,
  mlsJoinable: (deviceId) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/joinable-conversations`,
  mlsRoster: (conversationId) =>
    `/mls-handshakes/conversations/${encodePathParam(conversationId)}/roster`,
  mlsReleaseMembershipWork: (deviceId, conversationId) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/membership-work/${encodePathParam(conversationId)}/release`,
  mlsConsumeWelcome: (deviceId, welcomeId) =>
    `/mls-handshakes/devices/${encodePathParam(deviceId)}/welcomes/${encodePathParam(welcomeId)}/consume`,
  devTestUsers: '/dev/test-users',
  devTestUser: (id) => `/dev/test-users/${encodePathParam(id)}`,
  devTestUserImpersonate: (id) => `/dev/test-users/${encodePathParam(id)}/impersonate`,
};

function encodePathParam(value) {
  return encodeURIComponent(String(value || ''));
}

function decodePathParam(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

export function communitySymbol(name = '') {
  const lower = name.toLowerCase();
  if (lower.includes('wuthering')) return '\u263e';
  if (lower.includes('honkai')) return '\u2727';
  if (lower.includes('genshin')) return '\u2726';
  if (lower.includes('zenless')) return 'Z';
  if (lower.includes('gray') || lower.includes('raven')) return '\u25c7';
  return name.trim().charAt(0).toUpperCase() || '\u2726';
}

export function formatCount(value) {
  const number = Number(value || 0);
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}K`;
  return String(number);
}

export function normalizeGame(game) {
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

export function normalizePost(post) {
  const createdAt = post.createdAt ? new Date(post.createdAt) : null;
  const elapsed = createdAt && !Number.isNaN(createdAt.valueOf()) ? Date.now() - createdAt : null;
  const hours = elapsed === null ? null : Math.max(1, Math.floor(elapsed / 3_600_000));
  const time =
    hours === null ? 'Recently' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;

  return {
    id: post.id,
    title: post.title,
    author: post.author?.name || 'Unknown user',
    authorId: post.author?.id || post.authorId,
    authorImage: post.author?.image || null,
    time,
    tag: post.category?.name || post.tags?.[0]?.name || 'Discussion',
    gameName: post.game?.name,
    gameSlug: post.game?.slug,
    content: post.content || "",
    media: Array.isArray(post.media) ? post.media : [],
    visibility: post.visibility || "PUBLIC",
    isSpoiler: Boolean(post.isSpoiler),
    type: post.type || "GENERAL",
    likeCount: post.reactionCount ?? post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    likedByCurrentUser: Boolean(post.likedByCurrentUser),
    raw: post,
  };
}

function normalizePostResponse(post) {
  return post.raw ? post : normalizePost(post);
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
    meta: { total: items.length, source: 'local' },
  };
}

export function fallbackGame(slug) {
  const game = mockGames.find((item) => item.slug === slug || item.id === slug);
  return game ? normalizeGame(game) : null;
}

export function fallbackPosts({ gameSlug, search = '' } = {}) {
  const query = search.trim().toLowerCase();
  return posts
    .filter((post) => {
      const matchesGame = gameSlug ? post.gameSlug === gameSlug : true;
      const game = mockGames.find((item) => item.slug === post.gameSlug);
      const matchesSearch = query
        ? `${post.title} ${post.author} ${post.tag} ${game?.name || ''}`
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
        raw: post,
      };
    });
}

export function fallbackCategories() {
  return mockCategories;
}

function withQuery(path, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });

  return `${path}${params.toString() ? `?${params}` : ''}`;
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request(path, options = {}) {
  const { headers, body, allowUnauthorized = false, ...fetchOptions } = options;

  if (USE_MOCKS) return mockResponse(path, options);

  const shouldSendJsonHeader = body !== undefined && !(body instanceof FormData);
  // Uploads can be slow; everything else gets a deadline, because callers such as the MLS sync hold a lock while waiting.
  const timeout =
    body instanceof FormData ? {} : { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(shouldSendJsonHeader ? { 'Content-Type': 'application/json' } : {}),
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
      code = typeof errorBody.code === 'string' ? errorBody.code : undefined;
    } catch {
      message = await response.text().catch(() => '');
    }
    const error = new Error(message || `API request failed: ${response.status}`);
    error.status = response.status;
    // Machine-readable reason from the backend (e.g. MEMBERSHIP_CHANGE_PENDING), when it sent one.
    error.code = code;
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      error.retryAfterSeconds = retryAfterSeconds > 0 ? retryAfterSeconds : undefined;
    }
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

/** Submits an MLS handshake, returning a 409 as a structured { outcome: 'conflict', handshake } instead of throwing. */
async function submitMlsCommit(path, payload) {
  if (USE_MOCKS) return mutation(path, payload);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);

  if (response.status === 409 && body?.outcome === 'conflict') {
    return body;
  }
  if (!response.ok) {
    const error = new Error(body?.message || `API request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function mutation(path, payload, options = {}) {
  const { authHeaders, headers, ...fetchOptions } = options;
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return request(path, {
    ...fetchOptions,
    method: fetchOptions.method || 'POST',
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

const mockJoinedGames = new Set();

async function mockResponse(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const [pathname, queryString] = path.split('?');
  const params = new URLSearchParams(queryString || '');

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
  if (pathname === backendRoutes.latestFeed || pathname === backendRoutes.trendingFeed || pathname === backendRoutes.forYouFeed) {
    const items = params.has("cursor") ? [] : fallbackPosts();
    return { items, meta: { limit: Number(params.get("limit") || 20), hasMore: false, nextCursor: null, ...(pathname === backendRoutes.forYouFeed ? { personalized: false } : {}) } };
  }
  if (pathname === backendRoutes.posts && options.method === 'POST') {
    return { id: `mock-post-${Date.now()}`, ...JSON.parse(options.body || '{}') };
  }
  if (pathname === backendRoutes.posts) {
    const items = fallbackPosts({ search: params.get('search') || '' });
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (/^\/posts\/[^/]+$/.test(pathname)) {
    const postId = decodePathParam(pathname.split("/")[2]);
    const post = fallbackPosts().find((item) => item.id === postId);
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
  if (pathname === backendRoutes.signOut) { mockJoinedGames.clear(); return { ok: true }; }
  if (pathname === backendRoutes.gamesJoined) return { items: mockGames.filter((game) => mockJoinedGames.has(game.slug)) };
  if (/^\/games\/[^/]+\/(join|join-status)$/.test(pathname)) {
    const slug = decodePathParam(pathname.split('/')[2]);
    if (pathname.endsWith('/join')) {
      if (options.method === 'DELETE') mockJoinedGames.delete(slug);
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
  if (pathname.startsWith('/games/') && pathname.endsWith('/feed')) {
    const slug = decodePathParam(pathname.split('/')[2]);
    const categorySlug = params.get('categorySlug')?.toLowerCase();
    const items = fallbackPosts({ gameSlug: slug }).filter((post) => {
      if (!categorySlug) return true;
      const tag = post.tag.toLowerCase();
      return tag === categorySlug || `${tag}s` === categorySlug;
    });
    return { items: params.has("cursor") ? [] : items, meta: { limit: Number(params.get("limit") || 20), hasMore: false, nextCursor: null } };
  }
  if (pathname.startsWith('/games/')) {
    const slug = decodePathParam(pathname.split('/')[2]);
    const game = mockGames.find((item) => item.slug === slug || item.id === slug);
    if (!game) throw new Error('Game not found');
    return game;
  }
  if (/^\/chat-devices\/[^/]+\/key-packages\/status$/.test(pathname)) {
    return { singleUseRemaining: 10, lastResortExpiresAt: null };
  }
  if (pathname === backendRoutes.chatBackup) {
    if (options.method === 'PUT') return { enabled: true };
    if (options.method === 'DELETE') return { enabled: false };
    return { enabled: false, keyCheck: null, blobCount: 0, bytesUsed: 0 };
  }
  if (pathname === backendRoutes.chatBackupChallenge) return { nonce: '' };
  if (pathname === backendRoutes.chatBackupSchedule) {
    return { enabled: true, deletionScheduledFor: null };
  }
  if (pathname === backendRoutes.chatBackupBlobs) {
    if (options.method === 'POST') return { stored: 0, skipped: 0 };
    return { items: [], nextCursor: null };
  }
  if (pathname === backendRoutes.chatDevices && !options.method) return { items: [] };
  if (pathname.startsWith('/chat')) return [];
  return null;
}

async function uploadToCloudinary(file, authorization) {
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', authorization.apiKey);
  form.append('timestamp', String(authorization.timestamp));
  form.append('signature', authorization.signature);
  form.append('upload_preset', authorization.uploadPreset);
  form.append('folder', authorization.folder);
  form.append('public_id', authorization.publicId);
  form.append('overwrite', 'false');

  const response = await fetch(authorization.uploadUrl, { method: 'POST', body: form });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'Cloudinary upload failed');

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
async function uploadAndConfirm(files, purpose) {
  if (!files.length) return { successful: [], failed: [] };
  const authorizations = await api.createUploadSignatures(files, purpose);
  const settled = await Promise.allSettled(
    files.map((file, index) => uploadToCloudinary(file, authorizations.items[index])),
  );
  const uploaded = settled.flatMap((result, index) =>
    result.status === "fulfilled" ? [{ file: files[index], payload: result.value }] : [],
  );
  const failed = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ file: files[index], error: result.reason?.message || "Upload failed" }]
      : [],
  );

  if (!uploaded.length) return { successful: [], failed };

  const confirmed = await api.confirmMediaUploads(uploaded.map(({ payload }) => payload));
  const confirmedById = new Map(
    confirmed.successful.map(({ uploadId, result }) => [uploadId, result]),
  );
  const uploadedFileById = new Map(uploaded.map(({ file, payload }) => [payload.uploadId, file]));
  const confirmationErrors = new Map(
    confirmed.failed.map(({ uploadId, error }) => [uploadId, error]),
  );

  return {
    successful: uploaded.flatMap(({ payload }) => {
      const result = confirmedById.get(payload.uploadId);
      const file = uploadedFileById.get(payload.uploadId);
      return result ? [{ ...result, fileName: file?.name || "Uploaded media" }] : [];
    }),
    failed: [
      ...failed,
      ...uploaded.flatMap(({ file, payload }) => {
        const error = confirmationErrors.get(payload.uploadId);
        return error ? [{ file, error }] : [];
      }),
    ],
  };
}

function encryptedMessagePayload({
  ciphertext,
  encryptionMeta,
  contentType = 'TEXT',
  clientMessageId,
  replyToId,
  media,
}) {
  return {
    ciphertext,
    ...(encryptionMeta ? { encryptionMeta } : {}),
    ...(contentType ? { contentType } : {}),
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(replyToId ? { replyToId } : {}),
    ...(media?.length ? { media } : {}),
  };
}

const MEDIA_BATCH_SIZE = 10;

function chunked(items) {
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
  getGames: async (query = {}, options = {}) => {
    const response = await request(withQuery(backendRoutes.games, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizeGame),
      meta: response.meta || { total: items.length },
    };
  },
  /** Reads server-backed membership for the authenticated session. */
  getGameJoinStatus: (slug, options = {}) => request(backendRoutes.gameJoinStatus(slug), options),
  /** Idempotently joins the game as the authenticated session user. */
  joinGame: (slug) => mutation(backendRoutes.gameJoin(slug)),
  /** Idempotently leaves the game as the authenticated session user. */
  leaveGame: (slug) => mutation(backendRoutes.gameJoin(slug), undefined, { method: 'DELETE' }),
  /** Lists the session user's joined games using normal community shapes. */
  getJoinedGames: async (options = {}) => {
    const response = await request(backendRoutes.gamesJoined, options);
    return { items: (response.items || []).map(normalizeGame) };
  },
  getCommunity: async (slug) => normalizeGame(await request(backendRoutes.game(slug))),
  getCategories: (gameSlug, query = {}, options = {}) =>
    request(withQuery(backendRoutes.gameCategories(gameSlug), query), options),
  createCategory: (gameSlug, category) =>
    mutation(backendRoutes.gameCategories(gameSlug), category),
  updateCategory: (categoryId, updates) =>
    mutation(`/game-categories/${encodePathParam(categoryId)}`, updates, { method: "PATCH" }),
  getGameModerators: (gameSlug, options = {}) =>
    request(backendRoutes.gameModerators(gameSlug), options),
  assignGameModerator: (gameSlug, target) =>
    mutation(backendRoutes.gameModerators(gameSlug), target),
  removeGameModerator: (gameSlug, userId) =>
    mutation(backendRoutes.gameModerator(gameSlug, userId), undefined, { method: "DELETE" }),
  createGame: (game) => mutation(backendRoutes.games, game),
  updateGame: (gameId, updates) =>
    mutation(backendRoutes.game(gameId), updates, { method: "PATCH" }),
  // Moderator or admin of this specific game. Requires an already-confirmed
  // upload id from uploadSingleImage, not a raw URL.
  updateGameBranding: (gameSlug, { iconMediaUploadId, bannerMediaUploadId } = {}) =>
    mutation(
      backendRoutes.gameBranding(gameSlug),
      { iconMediaUploadId, bannerMediaUploadId },
      { method: "PATCH" },
    ),
  // Admin only - soft-deletes/restores the game community.
  archiveGame: (gameSlug) => mutation(backendRoutes.gameArchive(gameSlug), undefined, { method: "PATCH" }),
  restoreGame: (gameSlug) => mutation(backendRoutes.gameRestore(gameSlug), undefined, { method: "PATCH" }),
  // Moderator or admin - no state change, just an audit entry for an admin to review.
  flagGameForReview: (gameSlug, reason) => mutation(backendRoutes.gameFlag(gameSlug), { reason }),
  // The current user's own moderated games - backs the standalone /moderator page.
  listModeratedGames: (options = {}) => request(backendRoutes.gamesModerated, options),
  getCurrentUser: (options = {}) =>
    request(backendRoutes.currentUser, { ...options, allowUnauthorized: true }),
  getProfile: (options = {}) => api.getCurrentUser(options),
  // One-time claim - the backend 409s if this account already completed onboarding.
  completeOnboarding: ({ name, username }) =>
    mutation(backendRoutes.completeOnboarding, { name, username }, { method: "PATCH" }),
  // Needs an already-confirmed AVATAR upload id from uploadSingleImage; every call below returns the updated /users/me shape.
  updateAvatar: (avatarMediaUploadId) =>
    mutation(backendRoutes.userAvatar, { avatarMediaUploadId }, { method: "PATCH" }),
  removeAvatar: () => mutation(backendRoutes.userAvatar, undefined, { method: "DELETE" }),
  getBannerOptions: (options = {}) => request(backendRoutes.userBannerOptions, options),
  updateBanner: (bannerPresetId) =>
    mutation(backendRoutes.userBanner, { bannerPresetId }, { method: "PATCH" }),
  removeBanner: () => mutation(backendRoutes.userBanner, undefined, { method: "DELETE" }),
  checkUsernameAvailable: (username, options = {}) =>
    request(withQuery(backendRoutes.usernameAvailable, { username }), options),
  /** @param {{ limit?: number, signal?: AbortSignal }} [options] */
  searchUsers: (q, /** @type {{ limit?: number, signal?: AbortSignal }} */ options = {}) =>
    request(withQuery(backendRoutes.userSearch, { q, limit: options.limit ?? 8 }), {
      signal: options.signal,
    }),
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
  signOut: () => mutation(backendRoutes.signOut),
  getMyPosts: async (query = {}, options = {}) => {
    const response = await request(withQuery(backendRoutes.myPosts, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizePostResponse),
      meta: response.meta || { total: items.length },
    };
  },
  getLatestFeed: (query = {}, options = {}) =>
    api.getFeedCollection(backendRoutes.latestFeed, query, options),
  getForYouFeed: (query = {}, options = {}) =>
    api.getFeedCollection(backendRoutes.forYouFeed, query, options),
  getTrendingFeed: (query = {}, options = {}) =>
    api.getFeedCollection(backendRoutes.trendingFeed, query, options),
  getPosts: (query = {}, options = {}) =>
    api.getPostCollection(backendRoutes.posts, query, options),
  getPost: async (postId, options = {}) => {
    const post = await request(backendRoutes.post(postId), options);
    return normalizePostResponse(post);
  },
  getGameFeed: (gameSlug, query = {}, options = {}) =>
    api.getFeedCollection(backendRoutes.gameFeed(gameSlug), query, options),
  likePost: (postId) => mutation(backendRoutes.postLike(postId)),
  unlikePost: (postId) => mutation(backendRoutes.postLike(postId), undefined, { method: 'DELETE' }),
  getFollowStatus: (userId, options = {}) => request(backendRoutes.followStatus(userId), options),
  followUser: (userId) => mutation(backendRoutes.userFollow(userId)),
  unfollowUser: (userId) =>
    mutation(backendRoutes.userFollow(userId), undefined, { method: 'DELETE' }),
  getComments: (postId, query = {}, options = {}) =>
    request(withQuery(backendRoutes.postComments(postId), query), options),
  createComment: (postId, content) => mutation(backendRoutes.postComments(postId), { content }),
  getReplies: (commentId, query = {}, options = {}) =>
    request(withQuery(backendRoutes.commentReplies(commentId), query), options),
  createReply: (commentId, content) =>
    mutation(backendRoutes.commentReplies(commentId), { content }),
  createReport: (report) => mutation(backendRoutes.reports, report),
  createPost: (post) => mutation(backendRoutes.posts, post),
  createUploadSignatures: (files, purpose = 'POST') =>
    mutation(backendRoutes.mediaSignatures, {
      purpose,
      items: files.map((file) => ({
        resourceType: file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      })),
    }),
  confirmMediaUploads: (items) => mutation(backendRoutes.mediaConfirm, { items }),
  uploadPostMedia: (files) => uploadAndConfirm(files, "POST"),
  // Uploads one image for a non-post purpose (e.g. GAME_ICON, GAME_BANNER), returning its confirmed { mediaUploadId, secureUrl, ... }.
  uploadSingleImage: async (file, purpose) => {
    const { successful, failed } = await uploadAndConfirm([file], purpose);
    if (!successful.length) {
      throw new Error(failed[0]?.error || "Upload failed");
    }
    return successful[0];
  },
  /**
   * Uploads already-encrypted bytes as opaque raw blobs, returning upload ids in input order.
   * @param {{ bytes: Uint8Array, kind: "BLOB" | "THUMB" }[]} blobs
   */
  uploadChatBlobs: async (blobs) => {
    const uploaded = [];
    for (const batch of chunked(blobs)) {
      const authorizations = await mutation(backendRoutes.mediaSignatures, {
        purpose: 'CHAT',
        items: batch.map(({ kind }) => ({ opaqueKind: kind })),
      });
      const results = [];
      for (const [index, { bytes }] of batch.entries()) {
        const file = new Blob([bytes], { type: 'application/octet-stream' });
        results.push(await uploadToCloudinary(file, authorizations.items[index]));
      }
      const confirmed = await api.confirmMediaUploads(results);
      if (confirmed.failedCount) {
        throw new Error(confirmed.failed?.[0]?.error || 'Media confirmation failed');
      }
      const byId = new Map(confirmed.successful.map(({ uploadId, result }) => [uploadId, result]));
      uploaded.push(...results.map(({ uploadId }) => byId.get(uploadId).mediaUploadId));
    }
    return uploaded;
  },
  /** @returns {Promise<import("./feedTypes").FeedResponse<ReturnType<typeof normalizePostResponse>>>} */
  getFeedCollection: async (path, { limit = 20, cursor, type, sort, categorySlug } = {}, options = {}) => {
    const response = await request(withQuery(path, { limit, cursor, type, sort, categorySlug }), options);
    return { items: (response.items || []).map(normalizePostResponse), meta: response.meta };
  },
  getPostCollection: async (path, query = {}, options = {}) => {
    const response = await request(withQuery(path, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map(normalizePostResponse),
      meta: response.meta || { total: items.length },
    };
  },
  getHome: async ({ search = '' } = {}) => {
    const [games, latest, trending] = await Promise.all([
      api.getGames({ status: 'ACTIVE', search, limit: 20 }),
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
  getAdminOverview: (options = {}) => request(backendRoutes.adminOverview, options),
  listReports: (query = {}, options = {}) =>
    request(withQuery(backendRoutes.adminReports, query), options),
  claimReport: (gameSlug, reportId) =>
    mutation(backendRoutes.reportClaim(gameSlug, reportId), undefined, { method: "PATCH" }),
  resolveReport: (gameSlug, reportId, { resolutionNote } = {}) =>
    mutation(backendRoutes.reportResolve(gameSlug, reportId), { resolutionNote }, { method: "PATCH" }),
  dismissReport: (gameSlug, reportId, { resolutionNote } = {}) =>
    mutation(backendRoutes.reportDismiss(gameSlug, reportId), { resolutionNote }, { method: "PATCH" }),
  listAdminUsers: (query = {}, options = {}) =>
    request(withQuery(backendRoutes.adminUsers, query), options),
  setUserStatus: (userId, { status, reason }) =>
    mutation(backendRoutes.adminUserStatus(userId), { status, reason }, { method: "PATCH" }),
  listAdminContent: (query = {}, options = {}) =>
    request(withQuery(backendRoutes.adminContent, query), options),
  hideContent: (item) =>
    mutation(
      item.type === "POST"
        ? backendRoutes.postHide(item.gameSlug, item.id)
        : backendRoutes.commentHide(item.gameSlug, item.id),
      undefined,
      { method: "PATCH" },
    ),
  restoreContent: (item) =>
    mutation(
      item.type === "POST"
        ? backendRoutes.postRestore(item.gameSlug, item.id)
        : backendRoutes.commentRestore(item.gameSlug, item.id),
      undefined,
      { method: "PATCH" },
    ),
  getChatConversations: () => request(backendRoutes.chatConversations),
  getArchivedChatConversations: () => request(backendRoutes.chatArchivedConversations),
  /** @param {{ limit?: number, cursor?: string }} [query] @param {{ signal?: AbortSignal }} [options] */
  getNotifications: (query = {}, options = {}) =>
    request(withQuery(backendRoutes.notifications, query), { signal: options.signal }),
  getNotificationUnreadCount: ({ signal } = {}) =>
    request(backendRoutes.notificationsUnreadCount, { signal }),
  markNotificationRead: (notificationId) =>
    mutation(backendRoutes.notificationRead(notificationId), undefined, { method: 'PATCH' }),
  markAllNotificationsRead: () =>
    mutation(backendRoutes.notificationsReadAll, undefined, { method: 'PATCH' }),
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
  /** `notificationLevel` is ALL or NOTHING (muted); `mutedUntil` is an ISO time, omitted for an open-ended mute. */
  setChatNotificationLevel: (conversationId, { notificationLevel, mutedUntil }) =>
    mutation(
      backendRoutes.chatNotificationLevel(conversationId),
      { notificationLevel, mutedUntil },
      { method: 'PATCH' },
    ),
  createGroupChat: ({ title, photoUrl, memberUserIds }) =>
    mutation(backendRoutes.chatGroups, { title, photoUrl, memberUserIds }),
  updateGroupChat: (conversationId, { title, photoUrl }) =>
    mutation(backendRoutes.chatGroup(conversationId), { title, photoUrl }, { method: 'PATCH' }),
  addGroupMembers: (conversationId, userIds) =>
    mutation(backendRoutes.chatGroupMembers(conversationId), { userIds }),
  removeGroupMembers: (conversationId, userIds) =>
    mutation(backendRoutes.chatGroupMembers(conversationId), { userIds }, { method: 'DELETE' }),
  transferGroupOwnership: (conversationId, newOwnerUserId) =>
    mutation(backendRoutes.chatGroupTransferOwnership(conversationId), { newOwnerUserId }),
  updateGroupMemberRole: (conversationId, userId, role) =>
    mutation(backendRoutes.chatGroupMemberRole(conversationId, userId), { role }, { method: 'PATCH' }),
  leaveGroup: (conversationId) => mutation(backendRoutes.chatGroupLeave(conversationId)),
  markChatDelivered: (messageIds) => mutation(backendRoutes.chatDelivered, { messageIds }),
  // The server fetches the page; the sender attaches the result to the encrypted message.
  fetchLinkPreview: (url) => mutation(backendRoutes.linkPreviews, { url }),
  markChatRead: (conversationId, lastReadMessageId) =>
    mutation(
      backendRoutes.chatRead(conversationId),
      lastReadMessageId ? { lastReadMessageId } : {},
    ),
  // Reactions are plaintext (not part of the encrypted envelope) - one reaction per user per message.
  reactToMessage: (messageId, emoji) =>
    mutation(backendRoutes.chatMessageReactions(messageId), { emoji }),
  removeReaction: (messageId) =>
    mutation(backendRoutes.chatMessageReactions(messageId), undefined, { method: 'DELETE' }),
  // Own message only; soft delete (server clears the ciphertext, the row stays for history).
  /** Changes the signed-in user's settings (for now: sendReadReceipts, messageRequestSetting); answers with the /users/me shape. */
  updateProfile: (changes) => mutation(backendRoutes.currentUser, changes, { method: 'PATCH' }),
  /** The new text goes as a new encrypted message; `clientMessageId` makes a retry safe. */
  editChatMessage: (messageId, { ciphertext, encryptionMeta, clientMessageId }) =>
    mutation(backendRoutes.chatMessageEdits(messageId), { ciphertext, encryptionMeta, clientMessageId }),
  deleteChatMessage: (messageId) =>
    mutation(backendRoutes.chatMessage(messageId), undefined, { method: 'DELETE' }),
  // History backup: { enabled, keyCheck, deletionScheduledFor: ISO | null, blobCount, bytesUsed }. Blobs are opaque base64 ciphertext.
  getChatBackupStatus: () => request(backendRoutes.chatBackup),
  // Turns backup on: { keyCheck, replaceSecret }. Replacing an existing key also needs { replace: true, nonce, proof } and deletes every blob.
  putChatBackupKey: (payload) => mutation(backendRoutes.chatBackup, payload, { method: 'PUT' }),
  // Single-use nonce for the replace proof: { nonce }.
  getChatBackupChallenge: () => request(backendRoutes.chatBackupChallenge),
  // With { nonce, proof }, turns backup off and deletes every blob now; without, only schedules deletion -> { enabled, deletionScheduledFor }.
  deleteChatBackup: (proof = {}) =>
    mutation(backendRoutes.chatBackup, { confirm: true, ...proof }, { method: 'DELETE' }),
  // Cancels a scheduled deletion: { nonce, proof } required.
  cancelChatBackupDeletion: (proof) =>
    mutation(backendRoutes.chatBackupSchedule, proof, { method: 'DELETE' }),
  // items: [{ conversationId, messageId, ciphertext }], up to 100 -> { stored, skipped }.
  uploadChatBackupBlobs: (items) => mutation(backendRoutes.chatBackupBlobs, { items }),
  // One page: { items: [{ conversationId, messageId, ciphertext }], nextCursor: string | null }.
  getChatBackupBlobs: ({ after, limit } = {}) =>
    request(withQuery(backendRoutes.chatBackupBlobs, { after, limit })),
  registerChatDevice: (payload) => mutation(backendRoutes.chatDevices, payload),
  // Your own devices, recently removed ones included: { items: [{ id, ciphersuite, createdAt, lastSeenAt, revokedAt }] }.
  getChatDevices: () => request(backendRoutes.chatDevices),
  uploadChatDeviceKeyPackages: (deviceId, payload) =>
    mutation(backendRoutes.chatDeviceKeyPackages(deviceId), payload),
  // How many single-use key packages this device has left and when its last-resort one expires.
  getChatDeviceKeyPackageStatus: (deviceId) =>
    request(backendRoutes.chatDeviceKeyPackageStatus(deviceId)),
  // Two steps that tell the server this login is in this device's browser, so revoking the device ends
  // the login: get a challenge, then send it back signed with the device key.
  chatDeviceSessionChallenge: (deviceId) =>
    mutation(backendRoutes.chatDeviceSessionChallenge(deviceId)),
  linkChatDeviceSession: (deviceId, proof) =>
    mutation(backendRoutes.chatDeviceSession(deviceId), proof, { method: 'PUT' }),
  // Signs a device out of the app everywhere, at once; the device keeps its keys and its groups.
  signOutChatDevice: (deviceId) => mutation(backendRoutes.chatDeviceSignOut(deviceId)),
  revokeChatDevice: (deviceId) =>
    mutation(backendRoutes.chatDevice(deviceId), undefined, { method: 'DELETE' }),
  // One key package per active device of `userId` (an array). Pass excludeDeviceId when claiming your own
  // devices, and conversationId when finishing a change to a group you are in - the server then skips
  // devices already in that group and the DM privacy settings, which no longer apply.
  claimChatDeviceKeyPackages: (userId, { excludeDeviceId, conversationId, deviceIds } = {}) =>
    mutation(
      backendRoutes.chatDeviceClaim(userId, {
        excludeDeviceId,
        conversationId,
        deviceIds: deviceIds?.join(','),
      }),
    ),
  submitMlsHandshake: (conversationId, payload) =>
    submitMlsCommit(backendRoutes.mlsHandshakes(conversationId), payload),
  // A device adds itself to a group with no member online. Answers like submitMlsHandshake, incl. a lost race.
  submitMlsExternalJoin: (conversationId, payload) =>
    submitMlsCommit(backendRoutes.mlsExternalJoin(conversationId), payload),
  // The public snapshot of a group to join from, for one of your devices.
  getMlsGroupInfo: (conversationId, deviceId) =>
    request(withQuery(backendRoutes.mlsGroupInfo(conversationId), { deviceId })),
  // One cheap probe: does this device have welcomes, groups to join, or membership work waiting?
  getMlsPendingSummary: (deviceId) => request(backendRoutes.mlsPending(deviceId)),
  // Conversations this device could join by itself. scope "full" also finds a new device of an existing member.
  getMlsJoinableConversations: (deviceId, { scope } = {}) =>
    request(withQuery(backendRoutes.mlsJoinable(deviceId), { scope })),
  getMlsHandshakesSince: (conversationId, sinceEpoch = 0) =>
    request(withQuery(backendRoutes.mlsHandshakes(conversationId), { sinceEpoch })),
  getMlsPendingWelcomes: (deviceId, { after } = {}) =>
    request(withQuery(backendRoutes.mlsPendingWelcomes(deviceId), { after })),
  // Membership changes (devices to add or remove) this device can finish, and takes a lease on them.
  // scope "full" also finds new, revoked and leftover devices but costs more; conversationId looks at one conversation only.
  getMlsMembershipWork: (deviceId, { scope, after, conversationId } = {}) =>
    mutation(
      withQuery(backendRoutes.mlsMembershipWork(deviceId), { scope, after, conversationId }),
    ),
  // Who the server has in the group at an epoch, to check a ratchet tree against.
  getMlsRoster: (conversationId, epoch) =>
    request(withQuery(backendRoutes.mlsRoster(conversationId), { epoch })),
  // Give the lease back when this device could not finish a conversation's work.
  releaseMlsMembershipWork: (deviceId, conversationId) =>
    mutation(backendRoutes.mlsReleaseMembershipWork(deviceId, conversationId)),
  // Tell the server this device refused a Commit that did not match what it recorded.
  reportMlsFault: (conversationId, payload) =>
    mutation(backendRoutes.mlsFaults(conversationId), payload),
  consumeMlsWelcome: (deviceId, welcomeId) =>
    mutation(backendRoutes.mlsConsumeWelcome(deviceId, welcomeId)),
  // Dev tools only; 404 outside development.
  listDevTestUsers: () => request(backendRoutes.devTestUsers),
  createDevTestUser: (label) => mutation(backendRoutes.devTestUsers, label ? { label } : {}),
  impersonateDevTestUser: (id) => mutation(backendRoutes.devTestUserImpersonate(id)),
  deleteDevTestUser: (id) =>
    mutation(backendRoutes.devTestUser(id), undefined, { method: 'DELETE' }),
  deleteAllDevTestUsers: () =>
    mutation(backendRoutes.devTestUsers, undefined, { method: 'DELETE' }),
};
