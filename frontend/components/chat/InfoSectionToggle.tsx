"use client";

import { FiChevronDown } from "react-icons/fi";
import type { ReactNode } from "react";

/** The heading of a section of the info panel, styled like the Mute notifications row; a click folds the section away or opens it. */
export function InfoSectionToggle({
  icon,
  label,
  isOpen,
  onToggle,
}: {
  icon?: ReactNode;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button aria-expanded={isOpen} className="chat-info-row" onClick={onToggle} type="button">
      {icon} {label}
      <FiChevronDown aria-hidden="true" className="chat-info-row-chevron" />
    </button>
  );
}
