/** The conversation list with your mute setting applied to one conversation, for an instant update before the server answers. */
export function applyMute(conversations, conversationId, userId, { notificationLevel, mutedUntil }) {
  // Always a just-created mute here, so no expiry check: mutedUntil is in the future by construction.
  const muted = notificationLevel === "NOTHING";

  return conversations?.map((conversation) =>
    conversation.id !== conversationId
      ? conversation
      : {
          ...conversation,
          participants: conversation.participants.map((participant) =>
            participant.userId !== userId
              ? participant
              : {
                  ...participant,
                  notificationLevel,
                  mutedUntil: muted ? (mutedUntil ?? null) : null,
                  isMuted: muted,
                },
          ),
        },
  );
}
