import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { EnforcementPanel } from "../components/moderation/EnforcementPanel";
import { MyModeration, AppealsQueue } from "../components/moderation/Appeals";
import { api } from "../lib/api";
import type { EnforcementOverview, Sanction } from "../lib/enforcement";

vi.mock("next/navigation", () => ({ usePathname: () => "/moderation/appeals" }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "actor", role: "PLATFORM_MODERATOR", status: "ACTIVE" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));
const sanction: Sanction = {
  id: "sanction",
  type: "PLATFORM_SUSPENSION",
  reason: "Reviewed policy violation",
  startsAt: "2026-10-30T00:00:00Z",
  expiresAt: "2026-11-02T00:00:00Z",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  scope: "PLATFORM",
  game: null,
  appeal: null,
  caseId: "case",
  violationId: "violation",
  enforcementId: "hide",
};
const overview: EnforcementOverview = {
  subject: { id: "author", name: "Author" },
  scope: "PLATFORM",
  counts: {
    reports: 10,
    cases: 1,
    pending: 1,
    dismissedReports: 0,
    confirmedViolations: 0,
    reversedFindings: 0,
  },
  risk: {
    score: 0,
    tier: "LOW",
    explanation: "No effective confirmed violations. Reports alone do not increase this risk.",
    evaluatedAt: "2026-10-30T00:00:00Z",
    confirmedIncidents: 0,
    factors: [],
  },
  violations: [],
  sanctions: [],
  contentHistory: [],
  history: [],
  permissions: {
    canConfirm: true,
    canSanction: true,
    customDuration: true,
    scope: "PLATFORM",
    sanctionTypes: ["WARNING", "PLATFORM_SUSPENSION"],
  },
};
function mount(node: React.ReactNode) {
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
  vi.spyOn(api, "getCaseEnforcement").mockResolvedValue(structuredClone(overview));
  vi.spyOn(api, "issueCaseSanction").mockResolvedValue({});
  vi.spyOn(api, "confirmCaseViolation").mockResolvedValue({});
  vi.spyOn(api, "revokeSanction").mockResolvedValue({});
  vi.spyOn(api, "reverseViolation").mockResolvedValue({});
  vi.spyOn(api, "getMyModeration").mockResolvedValue({ items: [sanction], nextCursor: null });
  vi.spyOn(api, "submitModerationAppeal").mockResolvedValue({});
  vi.spyOn(api, "reviewModerationAppeal").mockResolvedValue({});
});
it("keeps allegations, confirmed findings and user risk distinct", async () => {
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  expect(await screen.findByText("Low user risk")).toBeVisible();
  expect(screen.getByText("Reports received").nextElementSibling).toHaveTextContent("10");
  expect(screen.getByText("Confirmed violations").nextElementSibling).toHaveTextContent("0");
  expect(screen.getByText(/Reports alone do not increase/)).toBeVisible();
  expect(screen.getByText(/Reports are allegations, not confirmed violations/)).toBeVisible();
});
it("keeps an expired sanction in history without offering to revoke or adjust it", async () => {
  vi.mocked(api.getCaseEnforcement).mockResolvedValue({
    ...overview,
    sanctions: [{ ...sanction, status: "EXPIRED", effectiveStatus: "EXPIRED" }],
  });
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  await screen.findByText("Restrictions and warnings");
  expect(screen.queryByRole("button", { name: "Revoke restriction" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adjust duration" })).not.toBeInTheDocument();
});
it("never offers permanent or unsupported sanctions, including a stale server response", async () => {
  vi.mocked(api.getCaseEnforcement).mockResolvedValue({
    ...overview,
    permissions: {
      ...overview.permissions,
      sanctionTypes: [
        "WARNING",
        "PLATFORM_SUSPENSION",
        "PERMANENT_BAN" as never,
        "PLATFORM_READ_ONLY" as never,
      ],
      durationDays: [1, 3, 7, 30, 365],
    },
  });
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  fireEvent.click(await screen.findByRole("button", { name: "Warn or restrict account" }));
  expect(
    screen.queryByRole("option", { name: /permanent|read-only|indefinite/i }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Restriction type"), {
    target: { value: "PLATFORM_SUSPENSION" },
  });
  expect(screen.queryByRole("option", { name: "365 days" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record decision" })).toBeDisabled();
});
it.each([0, 31, 365])("blocks custom duration %s in the moderator form", async (days) => {
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  fireEvent.click(await screen.findByRole("button", { name: "Warn or restrict account" }));
  fireEvent.change(screen.getByLabelText("Restriction type"), {
    target: { value: "PLATFORM_SUSPENSION" },
  });
  fireEvent.change(screen.getByLabelText("Duration from now"), { target: { value: "custom" } });
  const input = screen.getByLabelText("Custom duration in days");
  expect(input).toHaveAttribute("min", "1");
  expect(input).toHaveAttribute("max", "30");
  fireEvent.change(input, { target: { value: String(days) } });
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "An explicit human decision" },
  });
  expect(screen.getByRole("button", { name: "Record decision" })).toBeDisabled();
  expect(api.issueCaseSanction).not.toHaveBeenCalled();
});
it("limits community controls to the server-provided types", async () => {
  vi.mocked(api.getCaseEnforcement).mockResolvedValue({
    ...overview,
    scope: "COMMUNITY",
    permissions: {
      ...overview.permissions,
      customDuration: false,
      scope: "COMMUNITY",
      sanctionTypes: ["WARNING", "COMMUNITY_RESTRICTION", "COMMUNITY_BAN"],
    },
  });
  mount(<EnforcementPanel actorId="actor" caseId="case" gameSlug="game" />);
  fireEvent.click(await screen.findByRole("button", { name: "Warn or restrict account" }));
  expect(screen.queryByRole("option", { name: "Permanent platform ban" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Platform suspension" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Restriction type"), {
    target: { value: "COMMUNITY_RESTRICTION" },
  });
  expect(screen.getByLabelText("Duration from now")).toBeVisible();
  expect(screen.queryByRole("option", { name: "Custom duration" })).not.toBeInTheDocument();
});
it("supports an authorized custom duration without conflating it with a violation", async () => {
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  fireEvent.click(await screen.findByRole("button", { name: "Warn or restrict account" }));
  fireEvent.change(screen.getByLabelText("Restriction type"), {
    target: { value: "PLATFORM_SUSPENSION" },
  });
  fireEvent.change(screen.getByLabelText("Duration from now"), { target: { value: "custom" } });
  await userEvent.type(screen.getByLabelText("Custom duration in days"), "11");
  expect(screen.getByLabelText("Custom duration in days")).toHaveValue(11);
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Custom restriction after review" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
  await waitFor(() =>
    expect(api.issueCaseSanction).toHaveBeenCalledWith(
      "case",
      expect.objectContaining({ durationDays: 11 }),
      "",
    ),
  );
});
it("hides sanction controls when the server denies authority over this subject", async () => {
  vi.mocked(api.getCaseEnforcement).mockResolvedValue({
    ...overview,
    permissions: { ...overview.permissions, canSanction: false },
  });
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  await screen.findByText("Low user risk");
  expect(
    screen.queryByRole("button", { name: "Warn or restrict account" }),
  ).not.toBeInTheDocument();
});
it("requires an explicit human finding and preserves keyboard cancellation", async () => {
  const keyboard = userEvent.setup();
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  fireEvent.click(await screen.findByRole("button", { name: "Record confirmed violation" }));
  fireEvent.change(screen.getByLabelText("Decision reason"), {
    target: { value: "Confirmed by a human reviewer" },
  });
  await keyboard.keyboard("{Escape}");
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(api.confirmCaseViolation).not.toHaveBeenCalled();
});
it("shows clear failure and retry without retaining findings", async () => {
  vi.mocked(api.getCaseEnforcement).mockRejectedValueOnce({ status: 403 });
  mount(<EnforcementPanel actorId="actor" caseId="case" />);
  expect(await screen.findByText("Decision support unavailable.")).toBeVisible();
  expect(screen.queryByText("Low user risk")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry decision support" }));
  expect(await screen.findByText("Low user risk")).toBeVisible();
});
it("lets restricted users understand their sanction and appeal without reporter details", async () => {
  mount(<MyModeration />);
  expect(await screen.findByText("Platform suspension")).toBeVisible();
  expect(screen.getByText(/moderation notices and appeals remain available/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Appeal this decision" }));
  expect(screen.getByRole("button", { name: "Submit appeal" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Appeal explanation"), {
    target: { value: "Please review the quotation in its original context." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit appeal" }));
  await waitFor(() =>
    expect(api.submitModerationAppeal).toHaveBeenCalledWith(
      "sanction",
      "Please review the quotation in its original context.",
    ),
  );
  expect(document.body.textContent).not.toMatch(/reporterId|requestHash/);
});
it("does not offer duplicate appeals or appeals for revoked restrictions", async () => {
  vi.mocked(api.getMyModeration).mockResolvedValue({
    items: [{ ...sanction, status: "REVOKED", effectiveStatus: "REVOKED" }],
    nextCursor: null,
  });
  mount(<MyModeration />);
  await screen.findByText("Platform suspension");
  expect(screen.queryByRole("button", { name: "Appeal this decision" })).not.toBeInTheDocument();
});
it("only allows independent authorized appeal review and explains the reversal choices", async () => {
  vi.spyOn(api, "listModerationAppeals").mockResolvedValue({
    items: [
      {
        id: "appeal",
        statement: "Please reconsider this decision",
        status: "PENDING",
        createdAt: "2026-10-30T00:00:00Z",
        decisionReason: null,
        reviewedAt: null,
        canReview: true,
        sanction: { ...sanction, subjectId: "author" },
      },
    ],
    nextCursor: null,
  });
  mount(<AppealsQueue />);
  fireEvent.click(await screen.findByRole("button", { name: "Review appeal" }));
  fireEvent.change(screen.getByLabelText("Decision", { exact: true }), {
    target: { value: "ACCEPTED" },
  });
  fireEvent.click(screen.getByLabelText("Reverse the linked violation and its sanctions"));
  fireEvent.click(screen.getByLabelText("Reverse the linked content restriction if eligible"));
  fireEvent.change(screen.getByLabelText("Appeal decision reason"), {
    target: { value: "The evidence supports the appeal" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record appeal decision" }));
  await waitFor(() =>
    expect(api.reviewModerationAppeal).toHaveBeenCalledWith(
      "appeal",
      {
        decision: "ACCEPTED",
        reason: "The evidence supports the appeal",
        reverseViolation: true,
        restoreContent: true,
      },
      "",
    ),
  );
});
