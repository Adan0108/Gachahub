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
const groupName = (notification) => notification.conversation?.title || "Unnamed group";
const messages = (count) => (count > 1 ? `${count} messages` : "a message");

/** Per type: the sentence (it counts stacked messages; in a group the row's title is the group, so the sentence leaves it out), and where it leads (`href` returning null = nowhere to go, on purpose). */
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
        ? `sent ${messages(notification.count)}`
        : `sent you ${messages(notification.count)}`,
    href: chatHref,
  },
  MESSAGE_REPLIED: { action: () => "replied to your message", href: chatHref },
  GROUP_ADDED: {
    action: (notification) => (isGroup(notification) ? "added you" : "added you to a group"),
    href: chatHref,
  },
  GROUP_INVITE_PENDING: {
    action: (notification) => (isGroup(notification) ? "invited you" : "invited you to a group"),
    href: chatHref,
  },
};

/** A group's row is headed by the group and shows its photo, with the sender named in the sentence; every other row is headed by who did it. */
export function describeNotification(notification) {
  const kind = NOTIFICATION_KINDS[notification.type];
  const actor = notification.actor?.name || "Someone";
  const verb = kind?.action(notification) ?? "sent you a notification";
  const href = kind?.href(notification) ?? null;

  if (isGroup(notification)) {
    return {
      actor,
      title: groupName(notification),
      image: notification.conversation.photoUrl ?? null,
      action: `${actor} ${verb}`,
      href,
    };
  }

  return { actor, title: actor, image: notification.actor?.image ?? null, action: verb, href };
}
