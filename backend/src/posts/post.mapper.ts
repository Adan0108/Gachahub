/**
 * Create this mapper because both feed and post use this format function
 */
export function formatPost<
  T extends {
    tags: Array<{ tag: unknown }>;
    postSaves?: Array<{ userId: string }>;
    postLikes?: Array<{ userId: string }>;
  },
>(post: T) {
  const { tags, postLikes, postSaves, ...rest } = post;

  return {
    ...rest,
    tags: tags.map((postTag) => postTag.tag),
    savedByCurrentUser: (postSaves?.length ?? 0) > 0,
    likedByCurrentUser: (postLikes?.length ?? 0) > 0,
  };
}
