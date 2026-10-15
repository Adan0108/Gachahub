"use client";

import { ProfileToggleSetting } from "./ProfileToggleSetting";

/** The on/off switch for read receipts. */
export function ReadReceiptsSetting() {
  return (
    <ProfileToggleSetting
      description={
        <>
          When this is on, people can see when you have read their messages, and you can see when they have read
          yours. Turn it off and neither works. &quot;Delivered&quot; still shows either way.
        </>
      }
      field="sendReadReceipts"
      label="Read receipts"
    />
  );
}
