import {
  ALL_EQUIPPED_COSMETICS_SELECT,
  toEquippedSlotsMap,
} from '../cosmetics/cosmetic-starter-catalog';

/** Every field `session.user` used to expose, plus the profile banner and equipped cosmetics - see UsersService.getMe for why this is a live read instead. */
export const ME_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  bannerPresetId: true,
  createdAt: true,
  updatedAt: true,
  role: true,
  status: true,
  messageRequestSetting: true,
  sendReadReceipts: true,
  sendLinkPreviews: true,
  username: true,
  bio: true,
  onboarded: true,
  equippedCosmetics: ALL_EQUIPPED_COSMETICS_SELECT,
} as const;

export function mapMeEquipped<
  T extends {
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
  },
>(user: T) {
  if (!('equippedCosmetics' in user)) {
    return user;
  }
  const { equippedCosmetics, ...rest } = user;
  return {
    ...rest,
    equipped: toEquippedSlotsMap(equippedCosmetics),
  };
}
