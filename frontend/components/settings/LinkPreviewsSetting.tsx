"use client";

import { ProfileToggleSetting } from "./ProfileToggleSetting";

/** The on/off switch for link preview cards on the links you send. */
export function LinkPreviewsSetting() {
  return (
    <ProfileToggleSetting
      description="When this is on, a link you send gets a preview card with its title and picture. GachaHub's server loads the page to make it, so turn this off if you would rather your links never reach the server. Links other people send you are not affected."
      field="sendLinkPreviews"
      label="Link previews"
    />
  );
}
