"use client";

import { useEffect, useState } from "react";

/** `value`, but only once it has stopped changing for `delayMs`. */
export function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
