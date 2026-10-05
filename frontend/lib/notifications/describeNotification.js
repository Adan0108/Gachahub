const postHref = (notification) => {
  if (notification.entityType === "POST") return `/post/${notification.entityId}`;
  // A comment notification only knows its comment; the backend resolves the live post it sits on.
  return notification.postId ? `/post/${notification.postId}` : null;
};

const mentionHref = (notification) =>
  notification.entityType === "MESSAGE" ? "/chat" : postHref(notification);

const chatHref = () => "/chat";

/** Per type: the sentence, and where it leads (`href` returning null = nowhere to go, on purpose). */
const NOTIFICATION_KINDS = {
  POST_LIKED: { action: "liked your post", href: postHref },
  POST_COMMENTED: { action: "commented on your post", href: postHref },
  COMMENT_REPLIED: { action: "replied to your comment", href: postHref },
  // There is no profile route to send a new follower to yet.
  USER_FOLLOWED: { action: "followed you", href: () => null },
  USER_MENTIONED: { action: "mentioned you", href: mentionHref },
  MESSAGE_RECEIVED: { action: "sent you a message", href: chatHref },
  MESSAGE_REPLIED: { action: "replied to your message", href: chatHref },
  GROUP_ADDED: { action: "added you to a group", href: chatHref },
  GROUP_INVITE_PENDING: { action: "invited you to a group", href: chatHref },
};

export function describeNotification(notification) {
  const kind = NOTIFICATION_KINDS[notification.type];

  return {
    actor: notification.actor?.name || "Someone",
    action: kind?.action ?? "sent you a notification",
    href: kind?.href(notification) ?? null,
  };
}
