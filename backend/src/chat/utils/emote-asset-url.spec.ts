import { isOwnEmoteAssetUrl } from './emote-asset-url';

const CLOUD = 'gachahub-demo';

describe('isOwnEmoteAssetUrl', () => {
  it.each([
    [
      'an image on our account',
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/emotes/cat.png`,
    ],
    [
      'an animation on our account',
      `https://res.cloudinary.com/${CLOUD}/image/upload/emotes/cat.gif`,
    ],
    [
      'an address with a query string',
      `https://res.cloudinary.com/${CLOUD}/image/upload/cat.png?x=1`,
    ],
  ])('accepts %s', (_name, url) => {
    expect(isOwnEmoteAssetUrl(url, CLOUD)).toBe(true);
  });

  it.each([
    ['another site', 'https://evil.example/cat.png'],
    ['a tracking pixel', 'https://tracker.example/pixel.gif?u=1'],
    [
      "someone else's Cloudinary account",
      'https://res.cloudinary.com/other-account/image/upload/cat.png',
    ],
    [
      'an account whose name only starts like ours',
      `https://res.cloudinary.com/${CLOUD}-evil/image/upload/cat.png`,
    ],
    [
      'a look-alike host',
      `https://res.cloudinary.com.evil.example/${CLOUD}/cat.png`,
    ],
    [
      'a subdomain of the host',
      `https://evil.res.cloudinary.com/${CLOUD}/cat.png`,
    ],
    ['plain http', `http://res.cloudinary.com/${CLOUD}/image/upload/cat.png`],
    [
      'credentials in the address',
      `https://user:pw@res.cloudinary.com/${CLOUD}/cat.png`,
    ],
    ['a data address', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['a javascript address', 'javascript:alert(1)'],
    ['not an address', 'cat.png'],
    ['an empty string', ''],
  ])('refuses %s', (_name, url) => {
    expect(isOwnEmoteAssetUrl(url, CLOUD)).toBe(false);
  });

  it('refuses everything when the cloud name is not configured, since nothing can be checked', () => {
    expect(
      isOwnEmoteAssetUrl(
        `https://res.cloudinary.com/${CLOUD}/cat.png`,
        undefined,
      ),
    ).toBe(false);
    expect(isOwnEmoteAssetUrl(`https://res.cloudinary.com//cat.png`, '')).toBe(
      false,
    );
  });
});
