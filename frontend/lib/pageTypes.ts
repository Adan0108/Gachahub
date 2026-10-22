/** Response fields consumed by the app pages. */
export interface GameRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  developer?: string;
  publisher?: string;
  iconUrl?: string;
  bannerUrl?: string;
  symbol?: string;
  members?: number;
  status?: string;
  raw?: GameRecord;
}
export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
}
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "BANNED" | "DELETED";
  createdAt: string;
  username?: string | null;
}
export interface ContentRecord {
  id: string;
  type: string;
  title: string;
  authorName: string;
  gameSlug: string;
  reportCount: number;
  status: "PUBLISHED" | "HIDDEN";
}
export interface ReportRecord {
  id: string;
  gameId: string | null;
  game: { slug: string; name: string } | null;
  targetType: string;
  targetId: string;
  reasonCode: string;
  createdAt: string;
  status: "PENDING" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
}
export interface ModeratorAssignment {
  id?: string;
  user: {
    id: string;
    name?: string;
    email?: string;
    status?: string;
    image?: string | null;
    username?: string | null;
  };
  assigner?: { name?: string; email?: string };
  createdAt?: string;
}
export interface AuditRecord {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  actorName: string;
  occurredAt: string;
}
export interface MetricRecord {
  id: string;
  key?: string;
  label?: string;
  value: number;
  change?: string;
}
export interface FeedPost {
  id: string;
  gameSlug: string;
  tag: string;
}
