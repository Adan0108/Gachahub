const postHref = (notification) => {
  if (notification.entityType === "POST") return `/post/${notification.entityId}`;
  // A comment notification only knows its comment; the backend resolves the live post it sits on.
  return notification.postId ? `/post/${notification.postId}` : null;
};

// The backend says which conversation a chat notification belongs to; without it the chat just opens.
const chatHref = (notification) =>
  notification.conversationId ? `/chat?c=${encodeURIComponent(notification.conversationId)}` : "/chat";

const mentionHref = (notification) =>
  notification.entityType === "MESSAGE" ? chatHref(notification) : postHref(notification);

const isGroup = (notification) => notification.conversation?.type === "GROUP";
const groupName = (notification) => notification.conversation?.title || "a group";
const messages = (count) => (count > 1 ? `${count} messages` : "a message");

/** Per type: the sentence (it can name the group and count stacked messages), and where it leads (`href` returning null = nowhere to go, on purpose). */
const NOTIFICATION_KINDS = {
  POST_LIKED: { action: () => "liked your post", href: postHref },
  POST_COMMENTED: { action: () => "commented on your post", href: postHref },
  COMMENT_REPLIED: { action: () => "replied to your comment", href: postHref },
  // There is no profile route to send a new follower to yet.
  USER_FOLLOWED: { action: () => "followed you", href: () => null },
  USER_MENTIONED: { action: () => "mentioned you", href: mentionHref },
  MESSAGE_RECEIVED: {
    action: (notification) =>
      isGroup(notification)
        ? `sent ${messages(notification.count)} in ${groupName(notification)}`
        : `sent you ${messages(notification.count)}`,
    href: chatHref,
  },
  MESSAGE_REPLIED: {
    action: (notification) =>
      isGroup(notification)
        ? `replied to your message in ${groupName(notification)}`
        : "replied to your message",
    href: chatHref,
  },
  GROUP_ADDED: {
    action: (notification) => `added you to ${groupName(notification)}`,
    href: chatHref,
  },
  GROUP_INVITE_PENDING: {
    action: (notification) => `invited you to ${groupName(notification)}`,
    href: chatHref,
  },
};

/** "Group" or "Direct" for a chat notification, so a row says what kind of chat it is from at a glance; nothing for other kinds. */
function chatScope(notification) {
  if (!notification.conversation) return undefined;
  return isGroup(notification) ? "Group" : "Direct";
}

export function describeNotification(notification) {
  const kind = NOTIFICATION_KINDS[notification.type];

  return {
    actor: notification.actor?.name || "Someone",
    action: kind?.action(notification) ?? "sent you a notification",
    href: kind?.href(notification) ?? null,
    scope: chatScope(notification),
  };
}
