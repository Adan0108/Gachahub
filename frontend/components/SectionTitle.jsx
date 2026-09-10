import Link from "next/link";
import { FiChevronRight } from "react-icons/fi";

export function SectionTitle({ children, action, actionHref }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action && actionHref && (
        <Link className="text-btn" href={actionHref}>
          {action} <FiChevronRight />
        </Link>
      )}
    </div>
  );
}
