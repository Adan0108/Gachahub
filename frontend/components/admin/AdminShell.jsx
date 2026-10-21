"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FiActivity,
  FiAlertTriangle,
  FiChevronLeft,
  FiFileText,
  FiFlag,
  FiGrid,
  FiShield,
  FiUsers,
} from "react-icons/fi";
import { BrandMark } from "../BrandMark";

const navigation = [
  { href: "/admin", label: "Overview", icon: FiGrid, exact: true },
  { href: "/admin/communities", label: "Communities", icon: FiActivity },
  { href: "/admin/content", label: "Content", icon: FiFileText },
  { href: "/admin/moderation", label: "Moderation", icon: FiShield },
  { href: "/admin/users", label: "Users", icon: FiUsers },
  { href: "/admin/moderators", label: "Game moderators", icon: FiFlag },
  { href: "/moderation/cases", label: "Cases", icon: FiAlertTriangle },
];

export function AdminShell({ user, children, moderation = false }) {
  const pathname = usePathname() || "";
  const platformModerator = user?.role === "PLATFORM_MODERATOR";
  const items = platformModerator
    ? navigation.filter((item) => item.href === "/moderation/cases")
    : navigation;

  return (
    <div className={`admin-shell${moderation ? " moderation-console" : ""}`}>
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
          {items.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
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
