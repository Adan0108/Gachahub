"use client";

import { AvatarFace } from "./AvatarFace";
import "./MentionMenu.css";

/** Members suggested while typing an @; `picker` comes from useMentionPicker. Renders nothing without members. */
export function MentionMenu({ items, picker }) {
  if (picker.query === undefined || items.length === 0) return null;

  return (
    <ul aria-label="Suggested members" className="mention-menu" role="listbox">
      {items.map((member, index) => (
        <li
          aria-selected={index === picker.highlighted}
          className={index === picker.highlighted ? "active" : ""}
          key={member.id}
          onMouseDown={(event) => {
            event.preventDefault();
            picker.pick(member);
          }}
          onMouseEnter={() => picker.setHighlighted(index)}
          role="option"
        >
          <span className="chat-avatar small">
            <AvatarFace image={member.image} name={member.name} />
          </span>
          <span className="mention-menu-name">{member.name}</span>
          <span className="mention-menu-handle">@{member.username}</span>
        </li>
      ))}
    </ul>
  );
}
