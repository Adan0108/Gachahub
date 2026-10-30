type NotificationActor = { name?: string | null; image?: string | null };
type Notification = {
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  postId?: string | null;
  conversationId?: string | null;
  count?: number;
  actor?: NotificationActor | null;
  conversation?: { type?: string; title?: string | null; photoUrl?: string | null } | null;
  community?: { slug: string; name: string } | null;
};

type NotificationKind = {
  action: (notification: Notification) => string;
  href: (notification: Notification) => string | null;
};

const postHref = (notification: Notification) => {
  if (notification.entityType === "POST") return `/post/${notification.entityId}`;
  // A comment notification only knows its comment; the backend resolves the live post it sits on.
  return notification.postId ? `/post/${notification.postId}` : null;
};

// The backend says which conversation a chat notification belongs to; without it the chat just opens.
const chatHref = (notification: Notification) =>
  notification.conversationId
    ? `/chat?c=${encodeURIComponent(notification.conversationId)}`
    : "/chat";

// A mention in community chat opens that community's chat on the message.
const communityHref = (notification: Notification) =>
  notification.community
    ? `/community/${encodeURIComponent(notification.community.slug)}?tab=Chat&message=${encodeURIComponent(notification.entityId ?? "")}`
    : null;

const mentionHref = (notification: Notification) => {
  if (notification.entityType === "MESSAGE") return chatHref(notification);
  if (notification.entityType === "COMMUNITY_MESSAGE") return communityHref(notification);
  return postHref(notification);
};

const isGroup = (notification: Notification) => notification.conversation?.type === "GROUP";
const groupName = (notification: Notification) =>
  notification.conversation?.title || "Unnamed group";
const messages = (count = 1) => (count > 1 ? `${count} messages` : "a message");

/** Per type: the sentence (it counts stacked messages; in a group the sentence names the group too, under the group's own title), and where it leads (`href` returning null = nowhere to go, on purpose). */
const NOTIFICATION_KINDS: Record<string, NotificationKind> = {
  MODERATION_NOTICE: { action: () => "updated your moderation notices", href: () => "/account/moderation" },
  POST_LIKED: { action: () => "liked your post", href: postHref },
  POST_COMMENTED: { action: () => "commented on your post", href: postHref },
  COMMENT_REPLIED: { action: () => "replied to your comment", href: postHref },
  // There is no profile route to send a new follower to yet.
  USER_FOLLOWED: { action: () => "followed you", href: () => null },
  USER_MENTIONED: {
    action: (notification) =>
      notification.entityType === "COMMUNITY_MESSAGE" && notification.community
        ? `mentioned you in ${notification.community.name}`
        : "mentioned you",
    href: mentionHref,
  },
  MESSAGE_RECEIVED: {
    action: (notification) =>
      isGroup(notification)
        ? `sent ${messages(notification.count)} in ${groupName(notification)}`
        : `sent you ${messages(notification.count)}`,
    href: chatHref,
  },
  MESSAGE_REPLIED: {
    action: (notification) =>
      isGroup(notification) ? `replied to your message in ${groupName(notification)}` : "replied to your message",
    href: chatHref,
  },
  GROUP_ADDED: {
    action: (notification) => (isGroup(notification) ? `added you to ${groupName(notification)}` : "added you to a group"),
    href: chatHref,
  },
  GROUP_INVITE_PENDING: {
    action: (notification) => (isGroup(notification) ? `invited you to ${groupName(notification)}` : "invited you to a group"),
    href: chatHref,
  },
};

/** A group's row is headed by the group and shows its photo, with the sender named in the sentence; every other row is headed by who did it. */
export function describeNotification(notification: Notification) {
  if (notification.type === "MODERATION_NOTICE") return { actor: "GachaHub", title: "Moderation notice", image: null, action: "A moderation decision about your account was updated", href: "/account/moderation" };
  const kind = NOTIFICATION_KINDS[notification.type];
  const actor = notification.actor?.name || "Someone";
  const verb = kind?.action(notification) ?? "sent you a notification";
  const href = kind?.href(notification) ?? null;

  if (isGroup(notification)) {
    return {
      actor,
      title: groupName(notification),
      image: notification.conversation?.photoUrl ?? null,
      action: `${actor} ${verb}`,
      href,
    };
  }

  return { actor, title: actor, image: notification.actor?.image ?? null, action: verb, href };
}
