import "@testing-library/jest-dom/vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageSearchResults } from "../components/chat/MessageSearchResults";
import { SidebarMessageSearch } from "../components/chat/SidebarMessageSearch";
import { useSidebarMessageSearch } from "../hooks/chat/useSidebarMessageSearch";

const mocks = vi.hoisted(() => ({ state: {}, enabled: [] }));
vi.mock("../hooks/chat/useMessageSearchIndex", () => ({
  useMessageSearchIndex: (enabled) => {
    mocks.enabled.push(enabled);
    return mocks.state;
  },
}));

const person = (userId, name) => ({ userId, state: "ACTIVE", user: { id: userId, name } });
const dm = { id: "dm", type: "DIRECT", participants: [person("me", "Me"), person("bob", "Bob")] };
const group = {
  id: "group",
  type: "GROUP",
  title: "Weekend",
  participants: [person("me", "Me"), person("ann", "Ann")],
};

const hit = (messageId, conversationId, text) => ({ messageId, conversationId, text });
const HITS = [hit("m1", "group", "pizza night"), hit("m2", "group", "more pizza"), hit("m3", "dm", "pizza for two")];

/** A stand-in for the index: it only has to answer search(). */
function useFakeIndex(snapshot = {}) {
  const index = { search: vi.fn((query) => ({ terms: [query.toLowerCase()], hits: HITS })) };
  mocks.state = { index, status: "ready", version: 1, indexed: 0, total: 0, ...snapshot };
  return index;
}

describe("useSidebarMessageSearch", () => {
  beforeEach(() => {
    mocks.enabled = [];
  });

  it("holds the index while mounted", () => {
    useFakeIndex();
    renderHook(() => useSidebarMessageSearch("pizza", [dm, group]));

    expect(mocks.enabled.every((enabled) => enabled === true)).toBe(true);
  });

  it("groups matching messages by conversation, in list order", () => {
    useFakeIndex();
    const { result } = renderHook(() => useSidebarMessageSearch("pizza", [dm, group]));

    expect(result.current.isSearching).toBe(true);
    expect(result.current.groups.map((entry) => [entry.conversation.id, entry.hits.length])).toEqual([
      ["dm", 1],
      ["group", 2],
    ]);
    expect(result.current.terms).toEqual(["pizza"]);
  });

  it("finds nothing for a query that is too short, and only in the listed conversations", () => {
    const index = useFakeIndex();
    const { result, rerender } = renderHook(({ query, list }) => useSidebarMessageSearch(query, list), {
      initialProps: { query: "p", list: [dm, group] },
    });
    expect(result.current.isSearching).toBe(false);
    expect(result.current.groups).toEqual([]);
    expect(index.search).not.toHaveBeenCalled();

    rerender({ query: "pizza", list: [group] });

    expect(result.current.groups.map((entry) => entry.conversation.id)).toEqual(["group"]);
  });

  it("does not search again when only the conversation list is refreshed", () => {
    const index = useFakeIndex();
    const { result, rerender } = renderHook(({ list }) => useSidebarMessageSearch("pizza", list), {
      initialProps: { list: [dm, group] },
    });

    rerender({ list: [dm, group] });
    rerender({ list: [{ ...dm }, { ...group }] });

    expect(index.search).toHaveBeenCalledTimes(1);
    expect(result.current.groups).toHaveLength(2);
  });

  it("searches again when the index changes", () => {
    const index = useFakeIndex();
    const { rerender } = renderHook(() => useSidebarMessageSearch("pizza", [dm, group]));

    mocks.state = { ...mocks.state, version: 2 };
    rerender();

    expect(index.search).toHaveBeenCalledTimes(2);
  });
});

describe("SidebarMessageSearch", () => {
  beforeEach(() => {
    mocks.enabled = [];
  });

  it("shows the conversations with matching messages", () => {
    useFakeIndex();
    render(<SidebarMessageSearch conversations={[dm, group]} onSelect={vi.fn()} query="pizza" userId="me" />);

    expect(screen.getByRole("button", { name: /Weekend/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bob/ })).toBeInTheDocument();
  });

  it("shows nothing for a query that is too short", () => {
    useFakeIndex();
    const { container } = render(
      <SidebarMessageSearch conversations={[dm, group]} onSelect={vi.fn()} query="p" userId="me" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows how far indexing has got while it is still filling", () => {
    useFakeIndex({ status: "indexing", indexed: 30, total: 120 });
    render(<SidebarMessageSearch conversations={[dm, group]} onSelect={vi.fn()} query="pizza" userId="me" />);

    expect(screen.getByRole("status")).toHaveTextContent("Indexing messages on this device (25%)...");
  });
});

describe("MessageSearchResults", () => {
  const hits = (...texts) => texts.map((text, i) => ({ messageId: `m${i}`, conversationId: "group", text }));

  it("shows each conversation with a marked snippet, and how many matches", () => {
    render(
      <MessageSearchResults
        groups={[{ conversation: group, hits: hits("pizza night", "more pizza") }]}
        onSelect={vi.fn()}
        terms={["pizza"]}
        userId="me"
      />,
    );

    expect(screen.getByText("Weekend")).toBeInTheDocument();
    expect(screen.getByText("pizza")).toHaveProperty("tagName", "MARK");
    expect(screen.getByText("2 matches")).toBeInTheDocument();
  });

  it("opens the conversation when clicked", () => {
    const onSelect = vi.fn();
    render(
      <MessageSearchResults
        groups={[{ conversation: group, hits: hits("pizza night") }]}
        onSelect={onSelect}
        terms={["pizza"]}
        userId="me"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Weekend/ }));

    expect(onSelect).toHaveBeenCalledWith("group", "m0");
  });

  it("says it is indexing, and shows nothing at all when idle with no matches", () => {
    const { rerender, container } = render(
      <MessageSearchResults
        groups={[]}
        indexing={{ indexed: 0, total: 0 }}
        onSelect={vi.fn()}
        terms={["x"]}
        userId="me"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Indexing messages on this device...");

    rerender(<MessageSearchResults groups={[]} onSelect={vi.fn()} terms={["x"]} userId="me" />);
    expect(container).toBeEmptyDOMElement();
  });
});
