// Strips the internal MediaUpload-id bookkeeping fields before a Game row leaves this module, same reasoning as formatPost/MediaService.formatUpload.
export function formatGame<
  T extends {
    iconMediaUploadId?: string | null;
    bannerMediaUploadId?: string | null;
  },
>(game: T) {
  const { iconMediaUploadId, bannerMediaUploadId, ...rest } = game;

  return rest;
}
