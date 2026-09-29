// AES-GCM appends a 16-byte tag, so a ciphertext is always this much longer than its plaintext
export const GCM_TAG_BYTES = 16;

// Mirrors OPAQUE_MAX_BYTES in backend/src/media/opaque-blob.ts (tag included); limits.test.ts pins both
const MAX_BLOB_BYTES = 25 * 1024 * 1024;
const MAX_THUMB_BLOB_BYTES = 512 * 1024;

export const MAX_ATTACHMENT_BYTES = MAX_BLOB_BYTES - GCM_TAG_BYTES;
export const MAX_THUMBNAIL_BYTES = MAX_THUMB_BLOB_BYTES - GCM_TAG_BYTES;

// Mirrors MAX_OPAQUE_BLOBS_PER_MESSAGE on the backend (pinned by the same contract test)
export const MAX_FILES_PER_MESSAGE = 10;
// Client-side only: keeps a 10-file send from holding gigabytes of plaintext and ciphertext at once
export const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

// A solo image renders large (the full-width, count-1 case), so its thumbnail is worth more
// pixels; one sharing a message with other images renders small, as one grid tile, so it isn't.
export const THUMBNAIL_MAX_EDGE_GROUPED = 320;
export const THUMBNAIL_MAX_EDGE_SOLO = 640;
// Validation ceiling (attachmentEnvelope.ts) - the larger of the two modes above, since either
// can occur.
export const THUMBNAIL_MAX_EDGE = THUMBNAIL_MAX_EDGE_SOLO;
export const MAX_FILE_NAME_LENGTH = 120;
