/**
 * Create this mapper because both feed and post use this format function
 */
export function formatPost<
  T extends {
    tags: Array<{ tag: unknown }>;
    postLikes?: Array<{ userId: string }>;
  },
>(post: T) {
  const { tags, postLikes, ...rest } = post;

  return {
    ...rest,
    tags: tags.map((postTag) => postTag.tag),
    likedByCurrentUser: (postLikes?.length ?? 0) > 0,
  };
}
