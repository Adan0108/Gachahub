"use client";

export function CommunitySkeleton() {
  return (
    <div aria-busy="true" className="community-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index}>
          <span />
          <p />
        </div>
      ))}
    </div>
  );
}
