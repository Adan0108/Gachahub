import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { PostItem } from "../components/PostList";
import { CaseDetail } from "../components/moderation/CaseDetail";
import { ModeratorPicker } from "../components/moderation/ModeratorPicker";
import { api } from "../lib/api";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/moderation/cases/case",
}));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "actor", role: "PLATFORM_MODERATOR", status: "ACTIVE" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));
vi.mock("../components/SharePostDialog", () => ({ SharePostDialog: () => null }));
const post = {
  id: "p",
  title: "Short post",
  content: "Hi",
  author: "Author",
  authorId: "author",
  media: [],
};
const candidate = {
  id: "mod",
  name: "Radium",
  username: "radium",
  image: "https://example.com/avatar.png",
  role: "PLATFORM_MODERATOR",
};
const record = {
  id: "case",
  targetId: "p",
  targetType: "POST",
  status: "OPEN",
  reportCount: 1,
  uniqueReporterCount: 1,
  targetState: "available",
  target: { content: "Hi" },
  game: null,
  assignedModerator: candidate,
  evidence: {
    items: [
      {
        id: "r",
        reporter: null,
        reasonCode: "HATE",
        snapshot: { version: 1, content: "Evidence" },
      },
    ],
    nextCursor: null,
  },
};
function mount(node) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.spyOn(api, "createReport").mockResolvedValue({ id: "r" });
  vi.spyOn(api, "getComments").mockResolvedValue({
    items: [{ id: "c", content: "Comment", author: { name: "Commenter" } }],
  });
  vi.spyOn(api, "getFollowStatus").mockResolvedValue({ following: false });
  vi.spyOn(api, "getPlatformCase").mockResolvedValue(record);
  vi.spyOn(api, "searchPlatformCaseAssignees").mockResolvedValue({ items: [candidate] });
  vi.spyOn(api, "assignPlatformCase").mockResolvedValue(record);
});
it.each(["POST", "COMMENT"])(
  "requires an explicit %s report reason and resets it on keyboard close/reopen",
  async (type) => {
    const keyboard = userEvent.setup();
    mount(<PostItem post={post} detail variant="feed" />);
    const open = async () => {
      if (type === "POST") {
        fireEvent.click(screen.getByRole("button", { name: /More options/ }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
      } else fireEvent.click(await screen.findByRole("button", { name: "Report comment" }));
    };
    await open();
    expect(screen.getByLabelText("Reason")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Submit report" })).toBeDisabled();
    await keyboard.keyboard("{Enter}");
    expect(api.createReport).not.toHaveBeenCalled();
    await keyboard.selectOptions(screen.getByLabelText("Reason"), "HARASSMENT");
    expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
    await keyboard.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await open();
    expect(screen.getByLabelText("Reason")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Submit report" })).toBeDisabled();
  },
);

it.each(["POST", "COMMENT"])("shows a visible success toast after a %s report", async (type) => {
  mount(<PostItem post={post} detail variant="feed" />);
  if (type === "POST") {
    fireEvent.click(screen.getByRole("button", { name: /More options/ }));
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
  } else fireEvent.click(await screen.findByRole("button", { name: "Report comment" }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "HARASSMENT" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
  expect(await screen.findByText(/Report submitted/)).toBeVisible();
  expect(api.createReport).toHaveBeenCalledWith(
    expect.objectContaining({ targetType: type, targetId: type === "POST" ? "p" : "c" }),
  );
});
it.each([409, 500])(
  "keeps the report dialog open with clear failure feedback for %i",
  async (status) => {
    api.createReport.mockRejectedValue(Object.assign(new Error("failed"), { status }));
    mount(<PostItem post={post} variant="feed" />);
    fireEvent.click(screen.getByRole("button", { name: /More options/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "HARASSMENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      status === 409 ? "already reported" : "could not be submitted",
    );
    expect(screen.queryByText(/Report submitted/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
  },
);
it("keeps a tiny personal post's report menu outside the card clipping area", () => {
  mount(<PostItem post={{ ...post, content: "x", gameId: null }} variant="feed" />);
  fireEvent.click(screen.getByRole("button", { name: /More options/ }));
  expect(screen.getByRole("menu").parentElement).toBe(document.body);
  expect(screen.getByRole("menuitem", { name: "Report" })).toBeVisible();
});
it("shows eligible identities and makes selecting the existing moderator a no-op", async () => {
  mount(<CaseDetail caseId="case" />);
  expect(await screen.findByText(/Reported by Deleted user/)).toBeVisible();
  expect(screen.getByRole("navigation", { name: "Moderation navigation" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "My communities" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Assign another moderator" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Find moderator" }), {
    target: { value: "@radium" },
  });
  const select = await screen.findByRole("button", { name: "Select Radium (@radium)" });
  expect(select.querySelector("img")).toHaveAttribute("src", candidate.image);
  expect(select).toHaveTextContent("Platform moderator");
  fireEvent.click(select);
  expect(api.assignPlatformCase).not.toHaveBeenCalled();
});
it("clears stale picker results as the query changes", async () => {
  const search = vi.fn().mockResolvedValue({ items: [candidate] });
  mount(<ModeratorPicker actorId="actor" scopeKey="case" search={search} onSelect={vi.fn()} />);
  const input = screen.getByRole("searchbox", { name: "Find moderator" });
  fireEvent.change(input, { target: { value: "radium" } });
  expect(await screen.findByRole("button", { name: "Select Radium (@radium)" })).toBeVisible();
  fireEvent.change(input, { target: { value: "other" } });
  expect(screen.queryByRole("button", { name: "Select Radium (@radium)" })).not.toBeInTheDocument();
});
