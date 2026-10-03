import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MentionInput } from "../components/MentionInput";
import { MentionText } from "../components/MentionText";

const mocks = vi.hoisted(() => ({ searchUsers: vi.fn() }));

vi.mock("../lib/api", () => ({ api: { searchUsers: mocks.searchUsers } }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "me", username: "Me-1" } }),
}));

const iamme = { id: "u1", name: "I Am Me", username: "iamme", image: null };

function Harness({ onSubmit }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(text);
      }}
    >
      <MentionInput aria-label="comment" onChange={setText} value={text} />
    </form>
  );
}

function type(text) {
  const input = screen.getByLabelText("comment");
  fireEvent.change(input, { target: { value: text, selectionStart: text.length } });
  return input;
}

describe("MentionInput", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.searchUsers.mockReset().mockResolvedValue({ items: [iamme] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the real user once a full handle is typed", async () => {
    render(<Harness />);

    type("hey @iamme");
    await vi.advanceTimersByTimeAsync(400);

    expect(await screen.findByRole("button", { name: /I Am Me/ })).toBeInTheDocument();
    expect(mocks.searchUsers).toHaveBeenCalledWith("@iamme", expect.anything());
  });

  it("says so when nobody has that exact handle", async () => {
    mocks.searchUsers.mockResolvedValue({ items: [] });
    render(<Harness />);

    type("hey @iam");
    await vi.advanceTimersByTimeAsync(400);

    expect(await screen.findByText(/No one has the exact handle @iam/)).toBeInTheDocument();
  });

  it("does not look anything up for a bare @ or an email", async () => {
    render(<Harness />);

    type("hi @");
    type("mail me@iamme.com");
    await vi.advanceTimersByTimeAsync(400);

    expect(mocks.searchUsers).not.toHaveBeenCalled();
  });

  it("recognises your own handle instead of searching for someone else", async () => {
    mocks.searchUsers.mockResolvedValue({ items: [] });
    render(<Harness />);

    type("@me-1");
    await vi.advanceTimersByTimeAsync(400);

    expect(await screen.findByText("That's you.")).toBeInTheDocument();
  });

  it("fills in the canonical handle and tints it once picked", async () => {
    render(<Harness />);

    const input = type("hey @IAMME");
    await vi.advanceTimersByTimeAsync(400);
    fireEvent.click(await screen.findByRole("button", { name: /I Am Me/ }));

    expect(input).toHaveValue("hey @iamme ");
    expect(document.querySelector(".mention-input-backdrop .mention")).toHaveTextContent("@iamme");
    expect(screen.queryByRole("button", { name: /I Am Me/ })).not.toBeInTheDocument();
  });

  it("picks with Enter without submitting the form", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    const input = type("@iamme");
    await vi.advanceTimersByTimeAsync(400);
    await screen.findByRole("button", { name: /I Am Me/ });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("@iamme ");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes the dropdown on Escape", async () => {
    render(<Harness />);

    const input = type("@iamme");
    await vi.advanceTimersByTimeAsync(400);
    await screen.findByRole("button", { name: /I Am Me/ });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /I Am Me/ })).not.toBeInTheDocument(),
    );
  });
});

describe("MentionText", () => {
  it("tints only handles that were really mentioned", () => {
    const { container } = render(
      <p>
        <MentionText content="hi @iamme and @stranger" usernames={["IamMe"]} />
      </p>,
    );

    const tinted = container.querySelectorAll(".mention");
    expect(tinted).toHaveLength(1);
    expect(tinted[0]).toHaveTextContent("@iamme");
    expect(container).toHaveTextContent("hi @iamme and @stranger");
  });

  it("renders plain text when nothing was mentioned", () => {
    const { container } = render(
      <p>
        <MentionText content="just text @iamme" usernames={[]} />
      </p>,
    );

    expect(container.querySelector(".mention")).toBeNull();
    expect(container).toHaveTextContent("just text @iamme");
  });
});
