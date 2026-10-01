export const adminOverviewMock = {
  metrics: [
    { id: "members", label: "Total members", value: 1284910, change: 12.4, trend: "up" },
    { id: "communities", label: "Active communities", value: 38, change: 3.1, trend: "up" },
    { id: "reports", label: "Open reports", value: 47, change: 8.2, trend: "down" },
    { id: "moderators", label: "Game moderators", value: 126, change: 1.6, trend: "up" },
  ],
  communities: [
    { id: "game-1", name: "Genshin Impact", members: 418300, reports: 14, status: "ACTIVE" },
    { id: "game-2", name: "Wuthering Waves", members: 302140, reports: 9, status: "ACTIVE" },
    { id: "game-3", name: "Honkai: Star Rail", members: 281760, reports: 11, status: "ACTIVE" },
    { id: "game-4", name: "Zenless Zone Zero", members: 174920, reports: 7, status: "ACTIVE" },
  ],
  activity: [
    {
      id: "activity-1",
      action: "Report escalated",
      subject: "Post #GH-8421",
      occurredAt: "8 min ago",
    },
    {
      id: "activity-2",
      action: "Moderator assigned",
      subject: "Wuthering Waves",
      occurredAt: "34 min ago",
    },
    {
      id: "activity-3",
      action: "Community updated",
      subject: "Honkai: Star Rail",
      occurredAt: "1 hr ago",
    },
  ],
};

export const adminReportsMock = {
  items: [
    {
      id: "report-1842",
      targetType: "POST",
      targetId: "post-8421",
      reason: "Harassment",
      status: "OPEN",
      priority: "HIGH",
      createdAt: "2026-09-24T13:10:00.000Z",
    },
    {
      id: "report-1841",
      targetType: "COMMENT",
      targetId: "comment-601",
      reason: "Spam",
      status: "IN_REVIEW",
      priority: "MEDIUM",
      createdAt: "2026-09-24T12:42:00.000Z",
    },
  ],
  meta: { page: 1, limit: 20, total: 2 },
};

export const adminUsersMock = {
  items: [
    {
      id: "user-101",
      name: "Rover",
      email: "rover@example.com",
      role: "USER",
      status: "ACTIVE",
      joinedAt: "2026-07-12T09:30:00.000Z",
    },
    {
      id: "user-102",
      name: "Trailblazer",
      email: "trailblazer@example.com",
      role: "USER",
      status: "ACTIVE",
      joinedAt: "2026-07-16T15:18:00.000Z",
    },
  ],
  meta: { page: 1, limit: 20, total: 2 },
};

export const adminContentMock = {
  items: [
    {
      id: "post-8421",
      type: "POST",
      title: "Version guide discussion",
      authorName: "Rover",
      status: "PUBLISHED",
      reportCount: 4,
    },
    {
      id: "comment-601",
      type: "COMMENT",
      title: "Comment on team building guide",
      authorName: "Trailblazer",
      status: "PUBLISHED",
      reportCount: 2,
    },
  ],
  meta: { page: 1, limit: 20, total: 2 },
};
