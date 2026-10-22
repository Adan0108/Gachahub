import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BlockedPeopleList } from "../components/chat/BlockedPeopleList";

const people = [
  { id: "bo", name: "Bo", username: "bobear", image: null },
  { id: "cy", name: "Cy", username: null, image: null },
];

function setup(props = {}) {
  const handlers = { onUnblock: vi.fn(), onOpenChat: vi.fn(), onRetry: vi.fn() };
  render(
    <BlockedPeopleList
      chatIdByUserId={new Map([["bo", "c-bo"]])}
      isError={false}
      isLoading={false}
      people={people}
      unblockingId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("BlockedPeopleList", () => {
  it("lists each blocked person with their handle", () => {
    setup();

    expect(screen.getByText("Bo")).toBeInTheDocument();
    expect(screen.getByText("@bobear")).toBeInTheDocument();
    expect(screen.getByText("Cy")).toBeInTheDocument();
  });

  it("unblocks the person whose button was pressed", () => {
    const { onUnblock } = setup();
    const row = screen.getByText("Cy").closest("li")!;

    fireEvent.click(within(row).getByRole("button", { name: "Unblock" }));

    expect(onUnblock).toHaveBeenCalledWith("cy");
  });

  it("offers to open the chat only for someone you have a chat with", () => {
    const { onOpenChat } = setup();

    expect(screen.getAllByRole("button", { name: "Open chat" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

    expect(onOpenChat).toHaveBeenCalledWith("c-bo");
  });

  it("will not unblock the same person twice while it is going through", () => {
    setup({ unblockingId: "bo" });

    const [boButton, cyButton] = screen.getAllByRole("button", { name: "Unblock" });
    expect(boButton).toBeDisabled();
    expect(cyButton).toBeEnabled();
  });

  it("says when nobody is blocked", () => {
    setup({ people: [] });

    expect(screen.getByText("You have not blocked anyone.")).toBeInTheDocument();
  });

  it("says when it is loading, and offers a retry when it failed", () => {
    const { onRetry } = setup({ isLoading: true });
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    render(
      <BlockedPeopleList
        chatIdByUserId={new Map()}
        isError
        isLoading={false}
        onOpenChat={vi.fn()}
        onRetry={onRetry}
        onUnblock={vi.fn()}
        people={[]}
        unblockingId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
