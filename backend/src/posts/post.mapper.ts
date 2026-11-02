import {
  toEquippedFrameOnly,
  type EquippedCosmeticSummary,
} from '../cosmetics/cosmetic-starter-catalog';

type AuthorWithOptionalEquipped = {
  id: string;
  name: string;
  image: string | null;
  equippedCosmetics?: Array<{
    slot: 'FRAME' | 'PROFILE_BACKGROUND' | 'MINI_BACKGROUND' | 'BANNER';
    item: {
      id: string;
      slug: string;
      name: string;
      slot: 'FRAME' | 'PROFILE_BACKGROUND' | 'MINI_BACKGROUND' | 'BANNER';
      rarity: 'DUST' | 'GLINT' | 'GLIMMER' | 'RADIANT' | 'PRISMATIC';
      animated: boolean;
      assetUrl: string | null;
      presetId: string | null;
      active?: boolean;
    } | null;
  }>;
  equipped?: { frame: EquippedCosmeticSummary | null };
};

export function mapAuthorEquippedFrame<T extends AuthorWithOptionalEquipped>(
  author: T,
) {
  if (!author || !('equippedCosmetics' in author)) {
    return author;
  }
  const { equippedCosmetics, ...rest } = author;
  return {
    ...rest,
    equipped: toEquippedFrameOnly(equippedCosmetics),
  };
}

/**
 * Create this mapper because both feed and post use this format function
 */
export function formatPost<
  T extends {
    tags: Array<{ tag: unknown }>;
    postSaves?: Array<{ userId: string }>;
    postLikes?: Array<{ userId: string }>;
    author?: AuthorWithOptionalEquipped;
  },
>(post: T) {
  const { tags, postLikes, postSaves, author, ...rest } = post;

  return {
    ...rest,
    ...(author !== undefined
      ? { author: mapAuthorEquippedFrame(author) }
      : {}),
    tags: tags.map((postTag) => postTag.tag),
    savedByCurrentUser: (postSaves?.length ?? 0) > 0,
    likedByCurrentUser: (postLikes?.length ?? 0) > 0,
  };
}
