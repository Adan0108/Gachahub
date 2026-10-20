import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { CaseQueue } from "../components/moderation/CaseQueue";
import { CaseDetail } from "../components/moderation/CaseDetail";
import { api } from "../lib/api";

const session = vi.hoisted(() => ({
  user: { id: "actor", status: "ACTIVE", role: "PLATFORM_MODERATOR" },
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: session.user,
    isAuthenticated: Boolean(session.user),
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
const row = {
  targetState: "available",
  targetPreview: {
    title: "Guide to team building",
    excerpt: "A short preview",
    thumbnailUrl: "https://example.com/thumb.png",
    author: { name: "Author", username: "author" },
  },
  reasonSummary: [
    { reasonCode: "HARASSMENT", count: 2 },
    { reasonCode: "UNMARKED_SPOILERS", count: 1 },
  ],
  id: "case-1",
  targetType: "POST",
  targetId: "post",
  status: "OPEN",
  reportCount: 3,
  uniqueReporterCount: 2,
  game: null,
  createdAt: "2026-10-20",
  updatedAt: "2026-10-20",
};
const evidence = {
  id: "r1",
  reporter: { name: "Alex Rivera", image: "https://example.com/alex.png" },
  reasonCode: "SPAM",
  details: "Complaint details",
  snapshot: { version: 1, content: "Historical text", targetType: "POST" },
};
let record;
function mount(component) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {component}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  session.user = { id: "actor", role: "PLATFORM_MODERATOR", status: "ACTIVE" };
  record = {
    ...row,
    targetState: "available",
    target: { targetType: "POST", title: "Current title", content: "Current text" },
    evidence: { items: [evidence], nextCursor: null },
  };
  vi.spyOn(api, "getGames").mockResolvedValue({
    items: [{ id: "game", slug: "game-a", name: "Wuthering Waves" }],
    meta: { total: 1 },
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.spyOn(api, "listModeratedGames").mockResolvedValue([{ slug: "game-a" }]);
  vi.spyOn(api, "listPlatformCases").mockResolvedValue({
    items: [row],
    nextCursor: null,
  });
  vi.spyOn(api, "listGameCases").mockResolvedValue({
    items: [row],
    nextCursor: null,
  });
  vi.spyOn(api, "getPlatformCase").mockImplementation(async () => record);
  vi.spyOn(api, "getGameCase").mockImplementation(async () => record);
  vi.spyOn(api, "listPlatformCaseReports").mockResolvedValue({
    items: [{ ...evidence, id: "r2", details: "More evidence" }],
    nextCursor: null,
  });
  for (const name of [
    "claimPlatformCase",
    "resolvePlatformCase",
    "dismissPlatformCase",
    "claimGameCase",
  ])
    vi.spyOn(api, name).mockImplementation(async () => {
      record = {
        ...record,
        status: name.startsWith("claim")
          ? "IN_REVIEW"
          : name.startsWith("resolve")
            ? "RESOLVED"
            : "DISMISSED",
      };
      return record;
    });
});
it.each(["ADMIN", "PLATFORM_MODERATOR"])(
  "allows %s into the platform queue without admin system navigation for platform roles",
  async (role) => {
    session.user.role = role;
    mount(<CaseQueue />);
    expect(await screen.findByRole("link", { name: "View case" })).toBeInTheDocument();
    expect(screen.getByText("3 reports")).toBeInTheDocument();
    expect(screen.getByText("2 people")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(Boolean(screen.queryByRole("link", { name: "Admin console" }))).toBe(role === "ADMIN");
  },
);
it("shows content identity, top reasons and one detail link without fetching per-row detail", async () => {
  api.listPlatformCases.mockResolvedValue({
    items: [
      {
        ...row,
        reportCount: 4,
        reasonSummary: [...row.reasonSummary, { reasonCode: "OTHER", count: 1 }],
      },
    ],
    nextCursor: null,
  });
  mount(<CaseQueue />);
  expect(await screen.findByText("Guide to team building")).toBeVisible();
  expect(screen.getByText("A short preview")).toBeVisible();
  expect(screen.getByRole("img", { name: "Reported post thumbnail" })).toHaveAttribute(
    "src",
    "https://example.com/thumb.png",
  );
  expect(screen.getByText(/Author/)).toBeVisible();
  expect(screen.queryByText(/@author/)).not.toBeInTheDocument();
  expect(screen.getByText("+1 more")).toBeVisible();
  expect(screen.queryByText("Other concern")).not.toBeInTheDocument();
  expect(screen.getByText("Needs review", { selector: "span" })).toBeVisible();
  expect(screen.getByText("Unassigned")).toBeVisible();
  expect(screen.getByRole("link", { name: "View case" })).toHaveAttribute(
    "href",
    "/moderation/cases/case-1",
  );
  expect(screen.queryByText("case-1")).not.toBeInTheDocument();
  expect(screen.queryByText("post", { exact: true })).not.toBeInTheDocument();
  expect(api.getPlatformCase).not.toHaveBeenCalled();
  expect(api.listPlatformCaseReports).not.toHaveBeenCalled();
  expect(screen.queryByText(/No risk assessment/)).not.toBeInTheDocument();
});
it.each([
  [
    "COMMENT",
    "available",
    { excerpt: "A reported comment", author: { name: "Comment author" } },
    "A reported comment",
  ],
  [
    "POST",
    "available",
    { title: "", excerpt: "A personal post without a title" },
    "A personal post without a title",
  ],
  ["POST", "deleted", null, "Content deleted"],
  ["POST", "missing", null, "Content unavailable"],
])(
  "renders %s/%s previews and safe placeholders",
  async (targetType, targetState, targetPreview, title) => {
    api.listPlatformCases.mockResolvedValue({
      items: [
        {
          ...row,
          targetType,
          targetState,
          targetPreview,
          status: "IN_REVIEW",
          assignedModerator: { name: "Luna" },
        },
      ],
      nextCursor: null,
    });
    mount(<CaseQueue />);
    expect(await screen.findByText(title)).toBeVisible();
    expect(screen.getByText("Being reviewed", { selector: "span" })).toBeVisible();
    expect(screen.getByText("Luna")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  },
);
it("keeps IDs collapsed, hides absent risk and separates reason aggregates from evidence", async () => {
  mount(<CaseDetail caseId="case-1" />);
  expect(await screen.findByRole("heading", { name: "Why users reported this" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Current title");
  expect(screen.getByText("case-1")).not.toBeVisible();
  expect(screen.queryByText("Risk", { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Technical details", { exact: true }));
  expect(screen.getByText("case-1")).toBeVisible();
});
it.each(["USER", "GAME_MODERATOR"])("denies %s platform access even with assignments", (role) => {
  session.user.role = role === "GAME_MODERATOR" ? "USER" : role;
  mount(<CaseQueue />);
  expect(screen.getByText("Moderation access required")).toBeInTheDocument();
  expect(api.listPlatformCases).not.toHaveBeenCalled();
});
it("grants only assigned-game access to an ordinary moderator", async () => {
  session.user.role = "USER";
  const view = mount(<CaseQueue gameSlug="game-a" />);
  expect(await screen.findByText("3 reports")).toBeInTheDocument();
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <CaseQueue gameSlug="game-b" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Moderation access required")).toBeInTheDocument();
  expect(api.listGameCases).not.toHaveBeenCalledWith(
    "game-b",
    expect.anything(),
    expect.anything(),
  );
});
it.each(["ADMIN", "PLATFORM_MODERATOR"])(
  "allows %s game routes without assignment",
  async (role) => {
    session.user.role = role;
    mount(<CaseQueue gameSlug="game-b" />);
    expect(await screen.findByText("3 reports")).toBeInTheDocument();
    expect(api.listModeratedGames).not.toHaveBeenCalled();
  },
);
it("resets pagination on native status filters and encodes platform scope correctly", async () => {
  api.listPlatformCases.mockResolvedValue({
    items: [row],
    nextCursor: "next-boundary",
  });
  mount(<CaseQueue />);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(api.listPlatformCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next-boundary" }),
      expect.anything(),
    ),
  );
  fireEvent.change(screen.getByLabelText("Case status"), { target: { value: "OPEN" } });
  await waitFor(() =>
    expect(api.listPlatformCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined, status: "OPEN" }),
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("option", { name: "Pending" })).not.toBeInTheDocument();
});
it.each(["available", "deleted", "missing"])(
  "renders %s target safely and distinguishes historical evidence",
  async (state) => {
    record.targetState = state;
    if (state === "missing") record.target = null;
    mount(<CaseDetail caseId="case-1" />);
    expect(
      await screen.findAllByText(
        state === "available"
          ? "Content available"
          : state === "deleted"
            ? "Content deleted"
            : "Content unavailable",
        {},
        { timeout: 3000 },
      ),
    ).not.toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Reported content" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User reports" })).toBeInTheDocument();
    expect(screen.getByText("Historical text")).toBeInTheDocument();
  },
);
it("renders current comments, null/malformed snapshots and empty evidence", async () => {
  record.target = { targetType: "COMMENT", content: "Comment text", postId: "parent" };
  record.evidence.items[0] = { ...evidence, snapshot: { unexpected: true } };
  mount(<CaseDetail caseId="case-1" />);
  expect(await screen.findByText("Comment text")).toBeInTheDocument();
  expect(screen.getByText("No reported snapshot available.")).toBeInTheDocument();
});
it("loads only bounded later evidence pages", async () => {
  record.evidence.nextCursor = "opaque";
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more reports" }));
  expect(await screen.findByText("More evidence")).toBeInTheDocument();
  expect(api.listPlatformCaseReports).toHaveBeenCalledTimes(1);
  expect(api.listPlatformCaseReports).toHaveBeenCalledWith(
    "case-1",
    { cursor: "opaque", limit: 20 },
    expect.anything(),
  );
  expect(screen.queryByRole("button", { name: "Load more reports" })).not.toBeInTheDocument();
});
it.each(["RESOLVED", "DISMISSED"])(
  "keeps terminal %s cases readable without workflow controls",
  async (status) => {
    record.status = status;
    record.evidence = { items: [], nextCursor: null };
    mount(<CaseDetail caseId="case-1" />);
    expect(
      await screen.findByText(
        "No user reports available. Reports may have been removed with an account.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  },
);
it("claims an OPEN case and refreshes detail", async () => {
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument(),
  );
  expect(api.claimPlatformCase).toHaveBeenCalledWith("case-1", { resolutionNote: undefined });
});
it.each([
  ["OPEN", "Resolve"],
  ["OPEN", "Dismiss"],
  ["IN_REVIEW", "Resolve"],
  ["IN_REVIEW", "Dismiss"],
])("supports direct %s -> %s with optional note", async (status, action) => {
  record.status = status;
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: action }));
  fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: " Reviewed " } });
  fireEvent.click(screen.getByRole("button", { name: `${action} case` }));
  await waitFor(() =>
    expect(
      api[action === "Resolve" ? "resolvePlatformCase" : "dismissPlatformCase"],
    ).toHaveBeenCalledWith("case-1", { resolutionNote: "Reviewed" }),
  );
});
it("refreshes stale state after 409 instead of leaving actionable stale controls", async () => {
  api.claimPlatformCase.mockImplementation(async () => {
    record = { ...record, status: "RESOLVED" };
    throw Object.assign(new Error("Conflict"), { status: 409 });
  });
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  expect(await screen.findByText(/changed while you were reviewing/)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument(),
  );
  expect(api.getPlatformCase.mock.calls.length).toBeGreaterThan(1);
});

it("keeps a rejected decision editable after a 400", async () => {
  api.resolvePlatformCase.mockRejectedValue(
    Object.assign(new Error("Invalid note"), { status: 400 }),
  );
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resolve" }));
  fireEvent.click(screen.getByRole("button", { name: "Resolve case" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check the filters or note");
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});

it.each([403, 404])("hides detail after HTTP %s", async (status) => {
  api.getPlatformCase.mockRejectedValue(Object.assign(new Error("Unavailable"), { status }));
  mount(<CaseDetail caseId="case-1" />);
  expect(await screen.findByText("Case unavailable")).toBeInTheDocument();
  expect(screen.queryByText("Current text")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument();
});

it("removes evidence and workflow controls when later evidence access is revoked", async () => {
  record.evidence.nextCursor = "opaque";
  api.listPlatformCaseReports.mockRejectedValue(
    Object.assign(new Error("Forbidden"), { status: 403 }),
  );
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more reports" }));
  expect(
    await screen.findByText("Access to this case is no longer available."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Historical text")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument();
});

it("shows human report copy and copies identifiers only from optional technical details", async () => {
  record.target.postId = "parent-post";
  const view = mount(<CaseDetail caseId="case-1" />);
  expect(await screen.findByRole("heading", { name: "User reports" })).toBeVisible();
  expect(screen.getByText("Case review", { exact: true })).toBeVisible();
  expect(screen.getByText(/Reported by Alex Rivera/)).toBeVisible();
  expect(view.container.querySelector(".case-person-avatar img")).toHaveAttribute(
    "src",
    "https://example.com/alex.png",
  );
  expect(screen.getByText("View reported snapshot")).toBeVisible();
  expect(screen.queryByText("Historical report evidence")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy case id", hidden: true })).not.toBeVisible();
  fireEvent.click(screen.getByText("Technical details", { exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Copy case id" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("case-1"));
  expect(await screen.findByText("Case ID copied.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Copy content id" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("post"));
  fireEvent.click(screen.getByRole("button", { name: "Copy post id" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("parent-post"));
});
it("keeps technical values selectable when clipboard permission is unavailable", async () => {
  navigator.clipboard.writeText.mockRejectedValue(new Error("Denied"));
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByText("Technical details", { exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Copy case id" }));
  expect(await screen.findByText("Copy unavailable. Select the value to copy it.")).toBeVisible();
  expect(screen.getByText("case-1", { exact: true })).toBeVisible();
});
it("lets staff choose a community by display name without entering a technical address", async () => {
  mount(<CaseQueue />);
  fireEvent.change(await screen.findByLabelText("Content location"), { target: { value: "game" } });
  expect(screen.queryByLabelText("Game slug")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Find community"), { target: { value: "Wuthering" } });
  await waitFor(() =>
    expect(api.getGames).toHaveBeenLastCalledWith(
      { search: "Wuthering", limit: 20 },
      expect.anything(),
    ),
  );
  await screen.findByRole("option", { name: "Wuthering Waves" });
  fireEvent.change(screen.getByLabelText("Community", { exact: true }), {
    target: { value: "game-a" },
  });
  await waitFor(() =>
    expect(api.listPlatformCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "game", gameSlug: "game-a", cursor: undefined }),
      expect.anything(),
    ),
  );
  expect(screen.getByLabelText("Community", { exact: true }).selectedOptions[0]).toHaveTextContent(
    "Wuthering Waves",
  );
  expect(screen.queryByText("game-a", { exact: true })).not.toBeInTheDocument();
});
it("offers a clear retry when community search fails", async () => {
  api.getGames.mockRejectedValue(new Error("Offline"));
  mount(<CaseQueue />);
  fireEvent.change(await screen.findByLabelText("Content location"), { target: { value: "game" } });
  expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
    "Could not load communities",
  );
  api.getGames.mockResolvedValue({ items: [], meta: { total: 0 } });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No matching communities. Try another name.")).toBeVisible();
});

it("keeps archived communities selectable by name without restricting their status", async () => {
  api.getGames.mockResolvedValue({
    items: [{ id: "old-game", slug: "archived-game", name: "Old community", status: "ARCHIVED" }],
    meta: { total: 1 },
  });
  mount(<CaseQueue />);
  fireEvent.change(await screen.findByLabelText("Content location"), { target: { value: "game" } });
  await screen.findByRole("option", { name: "Old community" });
  expect(api.getGames).toHaveBeenCalledWith({ search: "", limit: 20 }, expect.anything());
  fireEvent.change(screen.getByLabelText("Community", { exact: true }), {
    target: { value: "archived-game" },
  });
  await waitFor(() =>
    expect(api.listPlatformCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ scope: "game", gameSlug: "archived-game" }),
      expect.anything(),
    ),
  );
});

it.each(["", "game-a"])("navigates cursor boundaries and the terminal batch in scope %s", async (gameSlug) => {
  const list = gameSlug ? api.listGameCases : api.listPlatformCases;
  const calls = (query, options) => [
    ...(gameSlug ? [gameSlug] : []), expect.objectContaining(query), options || expect.anything(),
  ];
  list.mockImplementation(async (...args) => args[gameSlug ? 1 : 0].cursor
    ? { items: [{ ...row, id: "older", targetPreview: { title: "Older content" } }], nextCursor: null }
    : { items: [row], nextCursor: "older-boundary" });
  mount(<CaseQueue gameSlug={gameSlug} />);
  expect(await screen.findByText("Guide to team building")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Older content")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(screen.queryByText("Guide to team building")).not.toBeInTheDocument();
  expect(list).toHaveBeenLastCalledWith(...calls({ cursor: "older-boundary", limit: 20 }));
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("Guide to team building")).toBeVisible();
  expect(list).toHaveBeenLastCalledWith(...calls({ cursor: undefined, limit: 20 }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Older content");
  fireEvent.change(screen.getByLabelText("Content type"), { target: { value: "COMMENT" } });
  await waitFor(() => expect(list).toHaveBeenLastCalledWith(
    ...calls({ cursor: undefined, targetType: "COMMENT", limit: 20 }),
  ));
  expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
  for (const args of list.mock.calls) {
    expect(args[gameSlug ? 1 : 0]).not.toHaveProperty("page");
    expect(args[gameSlug ? 1 : 0]).not.toHaveProperty("pagination");
  }
});

it("starts a fresh traversal when the game route changes", async () => {
  api.listGameCases.mockResolvedValue({ items: [row], nextCursor: "game-a-boundary" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><CaseQueue gameSlug="game-a" /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await waitFor(() => expect(api.listGameCases).toHaveBeenLastCalledWith(
    "game-a", expect.objectContaining({ cursor: "game-a-boundary" }), expect.anything(),
  ));
  view.rerender(<QueryClientProvider client={client}><CaseQueue gameSlug="game-b" /></QueryClientProvider>);
  await waitFor(() => expect(api.listGameCases).toHaveBeenLastCalledWith(
    "game-b", expect.objectContaining({ cursor: undefined }), expect.anything(),
  ));
  expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
});
