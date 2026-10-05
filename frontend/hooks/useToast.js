"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(defaultDuration = 1800) {
  const [notice, setNotice] = useState("");
  const timerRef = useRef(null);

  const clearNotice = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setNotice("");
  }, []);

  const showNotice = useCallback(
    (message, duration = defaultDuration) => {
      window.clearTimeout(timerRef.current);
      setNotice(message);
      timerRef.current = window.setTimeout(() => setNotice(""), duration);
    },
    [defaultDuration],
  );

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return { notice, showNotice, clearNotice };
}
