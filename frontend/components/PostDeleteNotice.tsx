"use client";

import { useEffect, useState } from "react";
import { FiCheckCircle, FiX } from "react-icons/fi";

export function PostDeleteNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), 6000);
    };
    window.addEventListener("post-deleted", show);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("post-deleted", show);
    };
  }, []);

  return (
    <div className="post-delete-notice-region" role="status" aria-live="polite" aria-atomic="true">
      {visible && (
        <div className="post-delete-notice">
          <FiCheckCircle aria-hidden="true" />
          <span>Post deleted.</span>
          <button
            aria-label="Dismiss deletion notice"
            onClick={() => setVisible(false)}
            type="button"
          >
            <FiX />
          </button>
        </div>
      )}
    </div>
  );
}
