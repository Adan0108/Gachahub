"use client";

import { usePresenceOf } from "../../hooks/presence/usePresenceOf";
import { AvatarFace } from "../AvatarFace";
import { PresenceDot } from "../PresenceDot";

/** A member's picture, with a green dot while they are online; you and people who have not accepted yet get none. */
export function MemberAvatar({
  participant,
  isSelf,
}: {
  participant: {
    userId: string;
    state?: string;
    user?: { name?: string | null; image?: string | null } | null;
  };
  isSelf?: boolean;
}) {
  const presence = usePresenceOf(!isSelf && participant.state === "ACTIVE" ? participant.userId : undefined);

  return (
    <span className="avatar-with-presence">
      <span className="chat-avatar small">
        <AvatarFace image={participant.user?.image} name={participant.user?.name} />
      </span>
      <PresenceDot status={presence} />
    </span>
  );
}
