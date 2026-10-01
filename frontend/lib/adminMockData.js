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
