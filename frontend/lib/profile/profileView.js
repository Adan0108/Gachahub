/** The profile to draw: your own comes from your live account (so a new picture or bio shows at once), anyone else's as the server sent it. */
export function profileToShow(profile, me, isSelf) {
  if (!isSelf || !me) return profile;
  return {
    ...profile,
    name: me.name,
    username: me.username,
    image: me.image,
    bannerPresetId: me.bannerPresetId,
    bio: me.bio ?? null,
  };
}

/** "Joined October 2026". */
export function joinedLabel(createdAt, locale) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return `Joined ${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)}`;
}

/** 1,240 -> "1.2K", for the counts under a name. */
export function compactCount(value, locale) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    value ?? 0,
  );
}

export const BIO_MAX_CHARS = 160;
export const NAME_MIN_CHARS = 2;
export const NAME_MAX_CHARS = 50;
