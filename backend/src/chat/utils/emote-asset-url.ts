const CLOUDINARY_HOST = 'res.cloudinary.com';

/**
 * True only for an https address on our own Cloudinary account. An emote picture is fetched by
 * every viewer's browser, so a link to anywhere else would reveal who is looking at the chat.
 */
export function isOwnEmoteAssetUrl(
  value: string,
  cloudName: string | undefined,
): boolean {
  if (!cloudName) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === CLOUDINARY_HOST &&
      url.username === '' &&
      url.password === '' &&
      url.pathname.startsWith(`/${cloudName}/`)
    );
  } catch {
    return false;
  }
}
