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

export function getPostMediaError(files, confirmedUploads = []) {
  const mediaTypes = [
    ...confirmedUploads.map((upload) => upload.resourceType),
    ...files.map((file) => (file.type.startsWith("video/") ? "VIDEO" : "IMAGE")),
  ];
  const videoCount = mediaTypes.filter((type) => type === "VIDEO").length;

  if (mediaTypes.length > 10) return "A post supports up to 10 files.";
  if (videoCount > 1) return "A post supports one video at most.";
  if (videoCount && mediaTypes.length > 1)
    return "Images and video cannot be mixed in the same post.";

  const oversized = files.find((file) => {
    const limit = file.type.startsWith("video/") ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    return file.size > limit;
  });

  return oversized ? `${oversized.name} exceeds the upload size limit.` : "";
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
