// Enum value -> admin pill class, one definition per domain shared across every admin page that renders it.
export const REPORT_STATUS_CLASS = {
  PENDING: "admin-status-pending",
  IN_REVIEW: "admin-status-in-review",
  RESOLVED: "admin-status-resolved",
  DISMISSED: "admin-status-dismissed",
};

export const USER_STATUS_CLASS = {
  ACTIVE: "",
  SUSPENDED: "admin-status-suspended",
  BANNED: "admin-status-banned",
  DELETED: "admin-status-deleted",
};

export const CONTENT_STATUS_CLASS = {
  PUBLISHED: "",
  HIDDEN: "admin-status-hidden",
};
