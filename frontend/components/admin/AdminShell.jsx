"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FiActivity,
  FiAlertTriangle,
  FiArchive,
  FiInbox,
  FiUserCheck,
  FiChevronLeft,
  FiFileText,
  FiFlag,
  FiGrid,
  FiShield,
  FiUsers,
} from "react-icons/fi";
import { BrandMark } from "../BrandMark";
import { caseViews, queueUrl } from "../../lib/moderation-queue";

const navigation = [
  { href: "/admin", label: "Overview", icon: FiGrid, exact: true },
  { href: "/admin/communities", label: "Communities", icon: FiActivity },
  { href: "/admin/content", label: "Content", icon: FiFileText },
  { href: "/admin/moderation", label: "Moderation", icon: FiShield },
  { href: "/admin/users", label: "Users", icon: FiUsers },
  { href: "/admin/moderators", label: "Moderators", icon: FiFlag },
  { href: "/moderation/cases", label: "Cases", icon: FiAlertTriangle },
];

export function AdminShell({ user, children, moderation = false, gameSlug = "", view = "all" }) {
  const pathname = usePathname() || "";
  const platformModerator = user?.role === "PLATFORM_MODERATOR";
  const reviewSurface =
    moderation || ["/admin/moderation", "/admin/moderators", "/admin/users"].includes(pathname);
  const items =
    moderation || platformModerator
      ? caseViews.map((item) => ({
          href: queueUrl(gameSlug, { view: item.value }),
          label: item.label,
          icon:
            { assigned: FiUserCheck, unassigned: FiInbox, history: FiArchive }[item.value] ||
            FiAlertTriangle,
          view: item.value,
        }))
      : navigation;

  return (
    <div
      className={`admin-shell${moderation ? " moderation-console" : ""}${reviewSurface ? " moderation-review-surface" : ""}`}
    >
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <BrandMark size={36} />
          <div>
            <b>GachaHub</b>
            <small>{platformModerator ? "Moderation console" : "Admin console"}</small>
          </div>
        </div>
        <nav
          aria-label={platformModerator ? "Moderation navigation" : "Admin navigation"}
          className="admin-nav"
        >
          {items.map(({ href, label, icon: Icon, exact, view: itemView }) => {
            const active = itemView
              ? view === itemView
              : exact
                ? pathname === href
                : pathname.startsWith(href);
            return (
              <Link
                aria-label={label}
                title={label}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
                href={href}
                key={href}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <Link className="admin-return-link" href="/">
          <FiChevronLeft aria-hidden="true" /> Back to GachaHub
        </Link>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <span>{platformModerator ? "Moderation" : "Administration"}</span>
            <small>{platformModerator ? "Platform safety" : "Platform operations"}</small>
          </div>
          <div className="admin-identity">
            <span>{user?.name?.charAt(0)?.toUpperCase() || "A"}</span>
            <div>
              <b>{user?.name || "Administrator"}</b>
              <small>{platformModerator ? "Platform moderator" : "Admin"}</small>
            </div>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
