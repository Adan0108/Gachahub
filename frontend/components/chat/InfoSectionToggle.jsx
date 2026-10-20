"use client";

import { FiChevronDown } from "react-icons/fi";

/** The heading of a section of the info panel; a click folds the section away or opens it. */
export function InfoSectionToggle({ label, isOpen, onToggle }) {
  return (
    <button aria-expanded={isOpen} className="chat-info-section-toggle" onClick={onToggle} type="button">
      {label}
      <FiChevronDown aria-hidden="true" className="chat-info-row-chevron" />
    </button>
  );
}
