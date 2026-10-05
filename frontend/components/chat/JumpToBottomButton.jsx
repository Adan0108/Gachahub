import { FiArrowDown } from "react-icons/fi";

/** Slides up over the bottom of the message list when you've scrolled away from the newest messages, and back down when you return. */
export function JumpToBottomButton({ visible, onClick }) {
  return (
    <button
      aria-hidden={!visible}
      aria-label="Jump to latest messages"
      className={`chat-jump-bottom${visible ? " visible" : ""}`}
      onClick={onClick}
      tabIndex={visible ? 0 : -1}
      type="button"
    >
      <FiArrowDown aria-hidden="true" />
    </button>
  );
}
