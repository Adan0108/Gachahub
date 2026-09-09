export function parsePostTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function getPostTagError(tags) {
  if (tags.length > 10) return "Use no more than 10 tags.";
  if (tags.some((tag) => tag.length > 80)) return "Each tag must be 80 characters or fewer.";
  return "";
}

export function buildPostPayload(form, tags, uploads) {
  return {
    gameId: form.gameId,
    ...(form.categoryId ? { categoryId: form.categoryId } : {}),
    title: form.title.trim(),
    content: form.content.trim(),
    type: form.type,
    status: form.status,
    visibility: form.visibility,
    isSpoiler: form.isSpoiler,
    ...(tags.length ? { tags } : {}),
    ...(uploads.length
      ? {
          media: uploads.map((upload, index) => ({
            mediaUploadId: upload.mediaUploadId,
            sortOrder: index,
          })),
        }
      : {}),
  };
}
