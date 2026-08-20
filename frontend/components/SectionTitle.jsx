import { FiChevronRight } from "react-icons/fi";

export function SectionTitle({ children, action }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action && (
        <button type="button">
          {action} <FiChevronRight />
        </button>
      )}
    </div>
  );
}
