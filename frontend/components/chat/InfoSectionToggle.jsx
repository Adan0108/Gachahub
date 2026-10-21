"use client";

import { FiChevronDown } from "react-icons/fi";

/** The heading of a section of the info panel, styled like the Mute notifications row; a click folds the section away or opens it. */
export function InfoSectionToggle({ icon, label, isOpen, onToggle }) {
  return (
    <button aria-expanded={isOpen} className="chat-info-row" onClick={onToggle} type="button">
      {icon} {label}
      <FiChevronDown aria-hidden="true" className="chat-info-row-chevron" />
    </button>
  );
}
