import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PostDeleteNotice } from "../components/PostDeleteNotice";

afterEach(() => vi.useRealTimers());

it("keeps the notice across child-page changes, then dismisses it automatically", () => {
  vi.useFakeTimers();
  const { rerender } = render(
    <>
      <p>Post page</p>
      <PostDeleteNotice />
    </>,
  );
  act(() => window.dispatchEvent(new Event("post-deleted")));
  rerender(
    <>
      <p>Feed page</p>
      <PostDeleteNotice />
    </>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Post deleted.");
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

it("restarts the dismissal timer after another deletion", () => {
  vi.useFakeTimers();
  render(<PostDeleteNotice />);
  act(() => window.dispatchEvent(new Event("post-deleted")));
  act(() => vi.advanceTimersByTime(5000));
  act(() => window.dispatchEvent(new Event("post-deleted")));
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toHaveTextContent("Post deleted.");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss deletion notice" }));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});
