import { mockCategories, mockGames, posts } from './mockData';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'
).replace(/\/$/, '');
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export const backendRoutes = {
  health: '/health',
  games: '/games',
  game: (slug) => `/games/${encodePathParam(slug)}`,
  gameCategories: (gameSlug) => `/games/${encodePathParam(gameSlug)}/categories`,
  currentUser: '/users/me',
  signInEmail: '/api/auth/sign-in/email',
  signUpEmail: '/api/auth/sign-up/email',
  signOut: '/api/auth/sign-out',
  myPosts: '/posts/mine',
  posts: '/posts',
  latestFeed: '/feed/latest',
  trendingFeed: '/feed/trending',
  gameFeed: (gameSlug) => `/games/${encodePathParam(gameSlug)}/feed`,
  postLike: (postId) => `/posts/${encodePathParam(postId)}/like`,
  userFollow: (userId) => `/users/${encodePathParam(userId)}/follow`,
  followStatus: (userId) => `/users/${encodePathParam(userId)}/follow-status`,
  postComments: (postId) => `/posts/${encodePathParam(postId)}/comments`,
  commentReplies: (commentId) => `/comments/${encodePathParam(commentId)}/replies`,
  mediaSignatures: '/media/uploads/signatures',
  mediaConfirm: '/media/uploads/confirm',
  chatConversations: '/chat/conversations',
  chatArchivedConversations: '/chat/conversations/archived',
  chatRequests: '/chat/requests',
  chatDirect: '/chat/direct',
  chatMessages: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/messages`,
  chatAcceptRequest: (conversationId) => `/chat/requests/${encodePathParam(conversationId)}/accept`,
  chatDeclineRequest: (conversationId) =>
    `/chat/requests/${encodePathParam(conversationId)}/decline`,
  chatBlockConversation: (conversationId) =>
    `/chat/conversations/${encodePathParam(conversationId)}/block`,
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
  chatRead: (conversationId) => `/chat/conversations/${encodePathParam(conversationId)}/read`,
  chatDevices: '/chat-devices',
  chatDeviceKeyPackages: (deviceId) => `/chat-devices/${encodePathParam(deviceId)}/key-packages`,
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
    time,
    tag: post.category?.name || post.tags?.[0]?.name || 'Discussion',
    gameName: post.game?.name,
    gameSlug: post.game?.slug,
    likeCount: post.reactionCount ?? post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    likedByCurrentUser: Boolean(post.likedByCurrentUser),
    raw: post,
  };
}

export function fallbackGames(search = '') {
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
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      error.retryAfterSeconds = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined;
    }
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

/**
 * Submits an MLS handshake without going through request()'s generic error
 * handling: a 409 there is not a failure to surface as a thrown Error, it's
 * a structured { outcome: 'conflict', handshake } body the sync engine
 * needs in full (the winning commit to catch up on) - request() would
 * collapse that down to just its `message` string and discard the rest.
 */
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
    throw new Error(body?.message || `API request failed: ${response.status}`);
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

async function mockResponse(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const [pathname, queryString] = path.split('?');
  const params = new URLSearchParams(queryString || '');

  if (pathname === backendRoutes.health) return { status: 'ok' };
  if (pathname === backendRoutes.currentUser) return null;
  if (pathname === backendRoutes.signInEmail || pathname === backendRoutes.signUpEmail)
    return { ok: true };
  if (pathname === backendRoutes.myPosts) {
    const items = fallbackPosts();
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (pathname === backendRoutes.latestFeed || pathname === backendRoutes.trendingFeed) {
    const items = fallbackPosts();
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (pathname === backendRoutes.posts && options.method === 'POST') {
    return { id: `mock-post-${Date.now()}`, ...JSON.parse(options.body || '{}') };
  }
  if (pathname === backendRoutes.posts) {
    const items = fallbackPosts({ search: params.get('search') || '' });
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (/^\/posts\/[^/]+\/comments$/.test(pathname)) {
    return { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  }
  if (/^\/comments\/[^/]+\/replies$/.test(pathname)) {
    return { items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  }
  if (/^\/users\/[^/]+\/follow-status$/.test(pathname)) return { following: false };
  if (pathname === backendRoutes.games) return fallbackGames(params.get('search') || '');
  if (pathname.startsWith('/games/') && pathname.endsWith('/categories'))
    return fallbackCategories();
  if (pathname.startsWith('/games/') && pathname.endsWith('/feed')) {
    const slug = decodePathParam(pathname.split('/')[2]);
    const categorySlug = params.get('categorySlug')?.toLowerCase();
    const items = fallbackPosts({ gameSlug: slug }).filter((post) => {
      if (!categorySlug) return true;
      const tag = post.tag.toLowerCase();
      return tag === categorySlug || `${tag}s` === categorySlug;
    });
    return { items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } };
  }
  if (pathname.startsWith('/games/')) {
    const slug = decodePathParam(pathname.split('/')[2]);
    const game = mockGames.find((item) => item.slug === slug || item.id === slug);
    if (!game) throw new Error('Game not found');
    return game;
  }
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

function encryptedMessagePayload({
  ciphertext,
  encryptionMeta,
  contentType = 'TEXT',
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
  getCurrentUser: (options = {}) =>
    request(backendRoutes.currentUser, { ...options, allowUnauthorized: true }),
  getProfile: (options = {}) => api.getCurrentUser(options),
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
      items: items.map((post) => (post.raw ? post : normalizePost(post))),
      meta: response.meta || { total: items.length },
    };
  },
  getLatestFeed: (query = {}, options = {}) =>
    api.getPostCollection(backendRoutes.latestFeed, query, options),
  getTrendingFeed: (query = {}, options = {}) =>
    api.getPostCollection(backendRoutes.trendingFeed, query, options),
  getPosts: (query = {}, options = {}) =>
    api.getPostCollection(backendRoutes.posts, query, options),
  getGameFeed: (gameSlug, query = {}, options = {}) =>
    api.getPostCollection(backendRoutes.gameFeed(gameSlug), query, options),
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
  createPost: (post) => mutation(backendRoutes.posts, post),
  createUploadSignatures: (files) =>
    mutation(backendRoutes.mediaSignatures, {
      purpose: 'POST',
      items: files.map((file) => ({
        resourceType: file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      })),
    }),
  confirmMediaUploads: (items) => mutation(backendRoutes.mediaConfirm, { items }),
  uploadPostMedia: async (files) => {
    if (!files.length) return [];
    const authorizations = await api.createUploadSignatures(files);
    const uploaded = await Promise.all(
      files.map((file, index) => uploadToCloudinary(file, authorizations.items[index])),
    );
    const confirmed = await api.confirmMediaUploads(uploaded);
    if (confirmed.failedCount) {
      throw new Error(confirmed.failed?.[0]?.error || 'Media confirmation failed');
    }
    return confirmed.successful.map(({ result }) => result);
  },
  getPostCollection: async (path, query = {}, options = {}) => {
    const response = await request(withQuery(path, query), options);
    const items = Array.isArray(response) ? response : response.items || [];
    return {
      items: items.map((post) => (post.raw ? post : normalizePost(post))),
      meta: response.meta || { total: items.length },
    };
  },
  getHome: async ({ search = '' } = {}) => {
    const [games, latest, trending] = await Promise.all([
      api.getGames({ status: 'ACTIVE', search, limit: 20 }),
      api.getLatestFeed({ page: 1, limit: 10 }),
      api.getTrendingFeed({ page: 1, limit: 10 }),
    ]);
    return {
      communities: games.items,
      forYouPosts: latest.items,
      posts: trending.items,
      meta: games.meta,
    };
  },
  getChatConversations: () => request(backendRoutes.chatConversations),
  getArchivedChatConversations: () => request(backendRoutes.chatArchivedConversations),
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
  markChatRead: (conversationId, lastReadMessageId) =>
    mutation(
      backendRoutes.chatRead(conversationId),
      lastReadMessageId ? { lastReadMessageId } : {},
    ),
  registerChatDevice: (payload) => mutation(backendRoutes.chatDevices, payload),
  uploadChatDeviceKeyPackages: (deviceId, payload) =>
    mutation(backendRoutes.chatDeviceKeyPackages(deviceId), payload),
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
  getMlsPendingWelcomes: (deviceId) => request(backendRoutes.mlsPendingWelcomes(deviceId)),
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
  // Dev tools only - the backend only registers these routes at all when
  // NODE_ENV === 'development' (DevModule in app.module.ts), so these calls
  // 404 in any other environment.
  listDevTestUsers: () => request(backendRoutes.devTestUsers),
  createDevTestUser: (label) => mutation(backendRoutes.devTestUsers, label ? { label } : {}),
  impersonateDevTestUser: (id) => mutation(backendRoutes.devTestUserImpersonate(id)),
  deleteDevTestUser: (id) =>
    mutation(backendRoutes.devTestUser(id), undefined, { method: 'DELETE' }),
  deleteAllDevTestUsers: () =>
    mutation(backendRoutes.devTestUsers, undefined, { method: 'DELETE' }),
};
