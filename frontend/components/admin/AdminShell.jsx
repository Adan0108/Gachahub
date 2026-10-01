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

const navigation = [
  { href: "/admin", label: "Overview", icon: FiGrid, exact: true },
  { href: "/admin/communities", label: "Communities", icon: FiActivity },
  { href: "/admin/content", label: "Content", icon: FiFileText },
  { href: "/admin/moderation", label: "Moderation", icon: FiShield },
  { href: "/admin/users", label: "Users", icon: FiUsers },
  { href: "/admin/moderators", label: "Game moderators", icon: FiFlag },
  { href: "/admin/reports", label: "Reports", icon: FiAlertTriangle },
];

export function AdminShell({ user, children }) {
  const pathname = usePathname();

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span aria-hidden="true">G</span>
          <div>
            <b>GachaHub</b>
            <small>Admin console</small>
          </div>
        </div>
        <nav aria-label="Admin navigation" className="admin-nav">
          {navigation.map(({ href, label, icon: Icon, exact }) => {
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
            <span>Administration</span>
            <small>Platform operations</small>
          </div>
          <div className="admin-identity">
            <span>{user?.name?.charAt(0)?.toUpperCase() || "A"}</span>
            <div>
              <b>{user?.name || "Administrator"}</b>
              <small>Admin</small>
            </div>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
