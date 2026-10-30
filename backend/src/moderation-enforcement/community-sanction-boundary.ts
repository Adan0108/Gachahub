import { SetMetadata } from '@nestjs/common';

export const COMMUNITY_SANCTION_BOUNDARY =
  'moderation:community-sanction-boundary';
/** Every handler delegates to CommunityAccessService, which resolves live scope and read/write permission. */
export const CommunitySanctionBoundary = () =>
  SetMetadata(COMMUNITY_SANCTION_BOUNDARY, true);
