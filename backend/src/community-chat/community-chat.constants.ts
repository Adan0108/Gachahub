export const COMMUNITY_MESSAGE_MAX_CHARS = 2000;
export const COMMUNITY_DELETE_REASON_MAX_CHARS = 200;
export const COMMUNITY_MESSAGE_MAX_IMAGES = 4;
/** People the @ autocomplete lists at most. */
export const COMMUNITY_MEMBER_SEARCH_LIMIT = 8;
/** The badge shows "99+" past this, so counting further is wasted work. */
export const COMMUNITY_UNREAD_CAP = 99;
export const COMMUNITY_HISTORY_DEFAULT_LIMIT = 50;
export const COMMUNITY_HISTORY_MAX_LIMIT = 100;
/** How much of a replied-to message is quoted. */
export const COMMUNITY_REPLY_SNIPPET_CHARS = 140;

/** Every community gets this room the first time its chat is opened. */
export const COMMUNITY_DEFAULT_CHANNEL = {
  slug: 'general',
  name: 'general',
  topic: null,
} as const;
