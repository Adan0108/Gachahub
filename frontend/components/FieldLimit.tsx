"use client";

/** Keep limit text out of the label's accessible name; fields reference it as a description. */
export function FieldLimit({
  value,
  max,
  id,
  unit = "characters",
}: {
  value: string;
  max: number;
  id: string;
  unit?: string;
}) {
  const reached = value.length >= max;
  return (
    <small id={id} className={`field-limit ${reached ? "field-warning" : ""}`} aria-hidden="true">
      {value.length}/{max} {unit}
      {reached ? " — Limit reached." : ""}
    </small>
  );
}
