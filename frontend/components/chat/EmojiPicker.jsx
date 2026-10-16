"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEmotes } from "../../hooks/chat/useEmotes";
import { buildCustomEmoji, choiceFromSelection } from "../../lib/emoji/customEmoji";

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The full emoji picker, loaded only when first opened. Calls `onPick` with a reaction choice ({ emoji } or { emoteId, emote }). */
export function EmojiPicker({ onPick, emojiOnly = false }) {
  const hostRef = useRef(null);
  const onPickRef = useRef(onPick);
  const [failed, setFailed] = useState(false);
  const { library, isLoading } = useEmotes();
  const custom = useMemo(() => buildCustomEmoji(library), [library]);

  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    // Built once the custom emotes are known, so their tabs are part of the picker from the start.
    if (isLoading) return undefined;

    let picker = null;
    let cancelled = false;

    Promise.all([import("emoji-mart"), import("@emoji-mart/data")])
      .then(([{ Picker }, dataModule]) => {
        if (cancelled || !hostRef.current) return;
        picker = new Picker({
          data: dataModule.default,
          custom: emojiOnly ? [] : custom.categories,
          theme: currentTheme(),
          previewPosition: "none",
          skinTonePosition: "search",
          navPosition: "top",
          maxFrequentRows: 2,
          onEmojiSelect: (selection) => {
            const choice = choiceFromSelection(selection, custom.byId);
            if (choice) onPickRef.current(choice);
          },
        });
        hostRef.current.appendChild(picker);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, [isLoading, custom, emojiOnly]);

  return (
    <div className="emoji-picker-host" ref={hostRef}>
      {failed && <small className="emoji-picker-error">Could not load emoji. Try again.</small>}
    </div>
  );
}
