import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/moderation/cases" }));
import { CaseQueue } from "../components/moderation/CaseQueue";
import { CaseDetail } from "../components/moderation/CaseDetail";
import { api } from "../lib/api";
import { moderationError } from "../lib/moderation";

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
let record: any;
function mount(component: any) {
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
it.each(["all", "assigned", "unassigned", "history"])(
  "requests the %s workload server-side and marks one sidebar entry active",
  async (view) => {
    mount(<CaseQueue query={{ view, targetType: "COMMENT" }} />);
    await waitFor(() =>
      expect(api.listPlatformCases).toHaveBeenCalledWith(
        expect.objectContaining({ view, targetType: "COMMENT" }),
        expect.anything(),
      ),
    );
    const nav = screen.getByRole("navigation", { name: "Moderation navigation" });
    const labels: Record<string, string> = {
      all: "Cases",
      assigned: "Assigned to me",
      unassigned: "Unassigned",
      history: "Resolved / History",
    };
    expect(within(nav).getByRole("link", { name: labels[view] })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "My communities" })).not.toBeInTheDocument();
  },
);

it.each(["", "game-a"])(
  "preserves filters and cursor in detail and back links for scope %s",
  async (gameSlug) => {
    const query = { view: "assigned", targetType: "COMMENT", cursor: "safe-cursor" };
    const result = mount(<CaseQueue gameSlug={gameSlug} query={query} />);
    const link = await screen.findByRole<HTMLAnchorElement>("link", { name: "View case" });
    const href = new URL(link.href);
    expect(href.pathname).toBe(
      gameSlug ? "/moderator/game-a/cases/case-1" : "/moderation/cases/case-1",
    );
    const context = href.searchParams.get("queue") ?? "";
    expect(new URLSearchParams(context).get("cursor")).toBe("safe-cursor");
    result.unmount();
    mount(<CaseDetail gameSlug={gameSlug} caseId="case-1" queue={context} />);
    const backUrl = new URL(
      screen.getByRole<HTMLAnchorElement>("link", { name: "← Back to cases" }).href,
    );
    expect(backUrl.pathname).toBe(gameSlug ? "/moderator/game-a/cases" : "/moderation/cases");
    expect(backUrl.searchParams.get("view")).toBe("assigned");
    expect(backUrl.searchParams.get("targetType")).toBe("COMMENT");
    expect(backUrl.searchParams.get("cursor")).toBe("safe-cursor");
  },
);

it("keeps ordinary game-moderator workload navigation inside the assigned game", async () => {
  session.user = { id: "actor", role: "USER", status: "ACTIVE" };
  mount(<CaseQueue gameSlug="game-a" query={{ view: "unassigned" }} />);
  expect(await screen.findByRole("link", { name: "Assigned to me" })).toHaveAttribute(
    "href",
    "/moderator/game-a/cases?view=assigned",
  );
  expect(screen.getByRole("link", { name: "Resolved / History" })).toHaveAttribute(
    "href",
    "/moderator/game-a/cases?view=history",
  );
  expect(screen.queryByRole("navigation", { name: "Admin navigation" })).not.toBeInTheDocument();
});

it("never displays a raw internal server error", () => {
  expect(moderationError({ status: 500, message: "SQL /server/private.ts" })).toBe(
    "Something went wrong. Please try again.",
  );
  expect(moderationError(new Error("Internal detail"))).toBe(
    "Something went wrong. Please try again.",
  );
});

it("defaults to active cases and refreshes from the first cursor page", async () => {
  vi.mocked(api.listPlatformCases).mockResolvedValue({ items: [row], nextCursor: "next-cursor" });
  mount(<CaseQueue />);
  expect(screen.getByRole<HTMLOptionElement>("option", { name: "Active cases" }).selected).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(api.listPlatformCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next-cursor" }),
      expect.anything(),
    ),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh cases" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Refresh cases" }));
  await waitFor(() =>
    expect(api.listPlatformCases).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined }),
      expect.anything(),
    ),
  );
  expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
});

it.each(["POST", "COMMENT"])(
  "opens %s context and confirms hide/restore independently of the case decision",
  async (targetType) => {
    record.targetType = targetType;
    record.gameId = "game";
    record.game = { name: "Game", slug: "game-a" };
    record.target = {
      targetType,
      status: "PUBLISHED",
      visibility: "PUBLIC",
      content: "Live evidence",
      postId: "parent",
      post: { status: "PUBLISHED", visibility: "PUBLIC", id: "parent" },
    };
    vi.spyOn(api, "decideCaseContent").mockImplementation(async (_id, body) => {
      record = { ...record, target: { ...record.target, status: body.hidden ? "HIDDEN" : "PUBLISHED" } };
      return {};
    });
    mount(<CaseDetail caseId="case-1" />);
    expect(await screen.findByRole("link", { name: "Open in context" })).toHaveAttribute(
      "href",
      targetType === "POST" ? "/post/post" : "/post/parent#comments",
    );
    fireEvent.click(
      screen.getByRole("button", { name: targetType === "POST" ? "Hide post" : "Hide comment" }),
    );
    expect(api.decideCaseContent).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Enforcement reason"), { target: { value: "Reviewed content policy concern" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide content" }));
    await waitFor(() =>
      expect(api.decideCaseContent).toHaveBeenCalledWith("case-1", { hidden: true, reason: "Reviewed content policy concern" }, ""),
    );
    expect(await screen.findByText("Content status: Hidden")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open in context" })).not.toBeInTheDocument();
    expect(screen.getByText("Historical text")).toBeInTheDocument();
    expect(api.resolvePlatformCase).not.toHaveBeenCalled();
    const restoreButton = screen.getByRole("button", { name: targetType === "POST" ? "Restore post" : "Restore comment" });
    await waitFor(() => expect(restoreButton).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(restoreButton);
    fireEvent.change(screen.getByLabelText("Enforcement reason"), { target: { value: "Review supports restoration" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore content" }));
    expect(await screen.findByText("Content status: Visible")).toBeVisible();
  },
);

it("shows visibility in decisions, uses non-destructive No violation copy and does not auto-hide", async () => {
  record.target.status = "PUBLISHED";
  record.target.visibility = "PUBLIC";
  vi.spyOn(api, "hideContent").mockResolvedValue({});
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Action taken" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText(/Content status: Visible/)).toHaveClass(
    "case-visibility-warning",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  const noViolation = screen.getByRole("button", { name: "No violation" });
  expect(noViolation.className).not.toContain("danger");
  fireEvent.click(noViolation);
  expect(screen.getByText("No policy violation was found.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Record no violation" }));
  await waitFor(() => expect(api.dismissPlatformCase).toHaveBeenCalled());
  expect(api.hideContent).not.toHaveBeenCalled();
});

it("warns before replacing an existing assignee and does not mutate on cancel", async () => {
  record.assignedModerator = { id: "old", name: "Alex Rivera" };
  vi.spyOn(api, "searchPlatformCaseAssignees").mockResolvedValue({
    items: [{ id: "new", name: "Luna Park", username: "luna", role: "PLATFORM_MODERATOR" }],
  });
  vi.spyOn(api, "assignPlatformCase").mockResolvedValue(record);
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign another moderator" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Find moderator" }), {
    target: { value: "@luna" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Select Luna Park (@luna)" }));
  expect(
    screen.getByText(
      "This case is currently assigned to Alex Rivera. Assign it to Luna Park instead?",
    ),
  ).toBeVisible();
  expect(api.assignPlatformCase).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Select Luna Park (@luna)" }));
  fireEvent.click(screen.getByRole("button", { name: "Reassign case" }));
  await waitFor(() =>
    expect(api.assignPlatformCase).toHaveBeenCalledWith("case-1", { assigneeId: "new" }),
  );
});

it("offers the authorized platform content action without granting account ban privileges", async () => {
  record.target.status = "PUBLISHED";
  record.target.visibility = "PUBLIC";
  mount(<CaseDetail caseId="case-1" />);
  expect(await screen.findByRole("button", { name: "Hide post" })).toBeVisible();
});

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
    vi.spyOn(api as any, name).mockImplementation(async () => {
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
    expect(screen.getByText("Reported by 2 people")).toBeInTheDocument();
    expect(screen.queryByText("3 reports")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(Boolean(screen.queryByRole("link", { name: "Admin console" }))).toBe(role === "ADMIN");
  },
);
it("shows content identity, top reasons and one detail link without fetching per-row detail", async () => {
  vi.mocked(api.listPlatformCases).mockResolvedValue({
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
  expect(screen.getByText("Unassigned", { selector: "td" })).toBeVisible();
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
    vi.mocked(api.listPlatformCases).mockResolvedValue({
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
  expect(await screen.findByText("Reported by 2 people")).toBeInTheDocument();
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
    expect(await screen.findByText("Reported by 2 people")).toBeInTheDocument();
    expect(api.listModeratedGames).not.toHaveBeenCalled();
  },
);
it("resets pagination on native status filters and encodes platform scope correctly", async () => {
  vi.mocked(api.listPlatformCases).mockResolvedValue({
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
    expect(await screen.findByText("No user reports available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Action taken" })).not.toBeInTheDocument();
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
  ["OPEN", "Action taken"],
  ["OPEN", "No violation"],
  ["IN_REVIEW", "Action taken"],
  ["IN_REVIEW", "No violation"],
])("supports direct %s -> %s with optional note", async (status, action) => {
  record.status = status;
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: action }));
  fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: " Reviewed " } });
  fireEvent.click(
    screen.getByRole("button", {
      name: action === "Action taken" ? "Record action taken" : "Record no violation",
    }),
  );
  await waitFor(() =>
    expect(
      api[action === "Action taken" ? "resolvePlatformCase" : "dismissPlatformCase"],
    ).toHaveBeenCalledWith("case-1", { resolutionNote: "Reviewed" }),
  );
});
it("refreshes stale state after 409 instead of leaving actionable stale controls", async () => {
  vi.mocked(api.claimPlatformCase).mockImplementation(async () => {
    record = { ...record, status: "RESOLVED" };
    throw Object.assign(new Error("Conflict"), { status: 409 });
  });
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
  expect(await screen.findByText(/changed while you were reviewing/)).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument(),
  );
  expect(vi.mocked(api.getPlatformCase).mock.calls.length).toBeGreaterThan(1);
});

it("keeps a rejected decision editable after a 400", async () => {
  vi.mocked(api.resolvePlatformCase).mockRejectedValue(
    Object.assign(new Error("Invalid note"), { status: 400 }),
  );
  mount(<CaseDetail caseId="case-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Action taken" }));
  fireEvent.click(screen.getByRole("button", { name: "Record action taken" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check the filters or note");
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});

it.each([403, 404])("hides detail after HTTP %s", async (status) => {
  vi.mocked(api.getPlatformCase).mockRejectedValue(Object.assign(new Error("Unavailable"), { status }));
  mount(<CaseDetail caseId="case-1" />);
  expect(await screen.findByText("Case unavailable")).toBeInTheDocument();
  expect(screen.queryByText("Current text")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Assign to me" })).not.toBeInTheDocument();
});

it("removes evidence and workflow controls when later evidence access is revoked", async () => {
  record.evidence.nextCursor = "opaque";
  vi.mocked(api.listPlatformCaseReports).mockRejectedValue(
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
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("Denied"));
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
  expect(screen.getByLabelText<HTMLSelectElement>("Community", { exact: true }).selectedOptions[0]).toHaveTextContent(
    "Wuthering Waves",
  );
  expect(screen.queryByText("game-a", { exact: true })).not.toBeInTheDocument();
});
it("offers a clear retry when community search fails", async () => {
  vi.mocked(api.getGames).mockRejectedValue(new Error("Offline"));
  mount(<CaseQueue />);
  fireEvent.change(await screen.findByLabelText("Content location"), { target: { value: "game" } });
  expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(
    "Could not load communities",
  );
  vi.mocked(api.getGames).mockResolvedValue({ items: [], meta: { total: 0 } });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No matching communities. Try another name.")).toBeVisible();
});

it("keeps archived communities selectable by name without restricting their status", async () => {
  vi.mocked(api.getGames).mockResolvedValue({
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

it.each(["", "game-a"])(
  "navigates cursor boundaries and the terminal batch in scope %s",
  async (gameSlug) => {
    const list = gameSlug ? api.listGameCases : api.listPlatformCases;
    const calls = (query: any, options?: any) => [
      ...(gameSlug ? [gameSlug] : []),
      expect.objectContaining(query),
      options || expect.anything(),
    ];
    vi.mocked(list).mockImplementation(async (...args: any[]) =>
      args[gameSlug ? 1 : 0].cursor
        ? {
            items: [{ ...row, id: "older", targetPreview: { title: "Older content" } }],
            nextCursor: null,
          }
        : { items: [row], nextCursor: "older-boundary" },
    );
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
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        ...calls({ cursor: undefined, targetType: "COMMENT", limit: 20 }),
      ),
    );
    expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
    for (const args of vi.mocked(list).mock.calls) {
      expect(args[gameSlug ? 1 : 0]).not.toHaveProperty("page");
      expect(args[gameSlug ? 1 : 0]).not.toHaveProperty("pagination");
    }
  },
);

it("starts a fresh traversal when the game route changes", async () => {
  vi.mocked(api.listGameCases).mockResolvedValue({ items: [row], nextCursor: "game-a-boundary" });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <CaseQueue gameSlug="game-a" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(api.listGameCases).toHaveBeenLastCalledWith(
      "game-a",
      expect.objectContaining({ cursor: "game-a-boundary" }),
      expect.anything(),
    ),
  );
  view.rerender(
    <QueryClientProvider client={client}>
      <CaseQueue gameSlug="game-b" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(api.listGameCases).toHaveBeenLastCalledWith(
      "game-b",
      expect.objectContaining({ cursor: undefined }),
      expect.anything(),
    ),
  );
  expect(await screen.findByRole("button", { name: "Previous" })).toBeDisabled();
});
