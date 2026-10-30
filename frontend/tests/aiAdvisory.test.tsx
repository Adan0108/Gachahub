import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { AiAdvisory } from "../components/moderation/AiAdvisory";
import { CaseDetail } from "../components/moderation/CaseDetail";
import { CaseQueue } from "../components/moderation/CaseQueue";
import { advisorySignals, advisoryStates, parseAiAdvisory } from "../lib/ai-advisory";
import { api } from "../lib/api";

vi.mock("next/navigation", () => ({ usePathname: () => "/moderation/cases" }));
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "actor", role: "PLATFORM_MODERATOR", status: "ACTIVE" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

const current = {
  state: "CURRENT",
  analysisGeneration: 1,
  policyVersion: "moderation-policy-v1",
  riskLevel: "HIGH",
  priorityScore: 73,
  signals: ["POSSIBLE_THREAT", "CONTEXT_REVIEW_REQUIRED"],
  evaluatedAt: "2026-10-30T00:00:00.000Z",
};
const record = {
  id: "first",
  targetId: "post",
  targetType: "POST",
  status: "OPEN",
  targetState: "available",
  target: {
    title: "Reported dialogue",
    content: "Game dialogue",
    status: "PUBLISHED",
    visibility: "PUBLIC",
  },
  targetPreview: { title: "Reported dialogue" },
  uniqueReporterCount: 1,
  reportCount: 1,
  evidence: { items: [], nextCursor: null },
  lastReportedAt: "2026-10-30T00:00:00Z",
  aiAdvisory: current,
  currentRiskLevel: "CRITICAL",
  currentRiskScore: 99,
};
function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (child: React.ReactNode) => (
    <QueryClientProvider client={client}>{child}</QueryClientProvider>
  );
  return { ...render(wrap(node)), wrap, client };
}
beforeEach(() => {
  vi.spyOn(api, "getPlatformCase").mockResolvedValue(record);
  vi.spyOn(api, "listPlatformCases").mockResolvedValue({ items: [record], nextCursor: null });
});

it.each([false, true])("renders all four current risk levels, compact=%s", (compact) => {
  const view = render(<AiAdvisory value={current} compact={compact} />);
  expect(screen.getByRole(compact ? "group" : "region", { name: "AI advisory" })).toBeVisible();
  for (const riskLevel of ["LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
    view.rerender(<AiAdvisory value={{ ...current, riskLevel }} compact={compact} />);
    expect(
      screen.getByText(`${riskLevel[0]}${riskLevel.slice(1).toLowerCase()} AI risk`),
    ).toBeVisible();
    expect(screen.getByText(/Possible threatening language/)).toBeVisible();
    expect(screen.queryByText(/73%/)).not.toBeInTheDocument();
  }
});

it.each(Object.entries(advisoryStates))(
  "suppresses historical HIGH findings for %s in both surfaces",
  (state, [title, description]) => {
    // Simulate a response polluted by generation 1's successful result alongside generation 2's state.
    const value = { ...current, state, analysisGeneration: 2 };
    const view = render(<AiAdvisory value={value} />);
    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(description)).toBeVisible();
    for (const compact of [false, true]) {
      view.rerender(<AiAdvisory value={value} compact={compact} />);
      expect(
        screen.queryByText(/High AI risk|Possible threatening language|73|2026/),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Assessment details")).not.toBeInTheDocument();
    }
    expect(parseAiAdvisory(value)).toEqual({ state, analysisGeneration: 2 });
  },
);

it.each(Object.entries(advisorySignals))(
  "explains backend signal %s without exposing its code",
  (signal, copy) => {
    render(<AiAdvisory value={{ ...current, signals: [signal] }} />);
    expect(screen.getByText(copy.label)).toBeVisible();
    expect(screen.getByText(copy.description)).toBeVisible();
    expect(screen.queryByText(signal)).not.toBeInTheDocument();
  },
);

it.each([
  undefined,
  null,
  [],
  "CURRENT",
  {},
  { state: "FUTURE_STATE", riskLevel: "HIGH" },
  { ...current, riskLevel: "UNKNOWN" },
  { ...current, priorityScore: NaN },
  { ...current, priorityScore: 101 },
  { ...current, priorityScore: -1 },
  { ...current, priorityScore: 1.5 },
  { ...current, signals: ["NEW_SIGNAL"] },
  { ...current, signals: ["toString"] },
  { ...current, signals: null },
  { ...current, signals: ["POSSIBLE_THREAT", "POSSIBLE_THREAT"] },
  { ...current, evaluatedAt: "invalid" },
  { ...current, evaluatedAt: null },
  { ...current, analysisGeneration: 0 },
  { ...current, analysisGeneration: undefined },
  { ...current, policyVersion: "future" },
  { ...current, state: "toString" },
  ...["riskLevel", "priorityScore", "signals", "evaluatedAt", "policyVersion"].map((field) => ({
    ...current,
    [field]: undefined,
  })),
])("handles an invalid payload without presenting current findings: %j", (value) => {
  expect(parseAiAdvisory(value)).toBeNull();
  render(<AiAdvisory value={value} />);
  expect(screen.getByText("AI assessment unavailable")).toBeVisible();
  expect(
    screen.queryByText(/High AI risk|Possible threatening language|73/),
  ).not.toBeInTheDocument();
});

it("keeps details keyboard accessible, explains the score and avoids sensitive metadata", async () => {
  const keyboard = userEvent.setup();
  render(
    <AiAdvisory
      value={{
        ...current,
        classifierProfile: "secret-profile",
        snapshotHash: "secret-hash",
        jobId: "secret-job",
      }}
    />,
  );
  const summary = screen.getByText("Assessment details");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await keyboard.tab();
  expect(summary).toHaveFocus();
  // jsdom does not implement the browser's native summary keyboard activation.
  // Real Chromium coverage verifies Enter; here verify focus and disclosure content.
  await keyboard.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(screen.getByText("73 / 100")).toBeVisible();
  expect(screen.getByText(/not a probability or confidence percentage/)).toBeVisible();
  expect(screen.getByText(/AI findings are advisory, not confirmed violations/)).toBeVisible();
  expect(screen.getByText(new Date(current.evaluatedAt).toLocaleString())).toHaveAttribute(
    "dateTime",
    current.evaluatedAt,
  );
  expect(document.body.textContent).not.toMatch(
    /secret-profile|secret-hash|secret-job|moderation-policy-v1/,
  );
});

it("does not equate an empty signal list with safe content", () => {
  render(<AiAdvisory value={{ ...current, riskLevel: "LOW", signals: [] }} />);
  expect(screen.getByText(/does not confirm that the content is safe/)).toBeVisible();
});

it("renders queue advisory without legacy risk and preserves filter/cursor requests", async () => {
  mount(<CaseQueue query={{ view: "assigned", targetType: "COMMENT", cursor: "boundary" }} />);
  expect(await screen.findByText("High AI risk")).toBeVisible();
  expect(screen.queryByText(/critical/i)).not.toBeInTheDocument();
  expect(api.listPlatformCases).toHaveBeenCalledWith(
    expect.objectContaining({ view: "assigned", targetType: "COMMENT", cursor: "boundary" }),
    expect.anything(),
  );
  expect(screen.getByRole("link", { name: "View case" }).getAttribute("href")).toContain("queue=");
});

it.each([
  "ANALYSIS_PENDING",
  "ANALYSIS_FAILED",
  "CONTENT_CHANGED",
  "CASE_CLOSED",
  "UNSUPPORTED_EVIDENCE",
] as const)("replaces successful generation 1 with %s, never historical risk", async (state) => {
  const { client } = mount(<CaseDetail caseId="first" />);
  expect(await screen.findByText("High AI risk")).toBeVisible();
  vi.mocked(api.getPlatformCase).mockResolvedValue({
    ...record,
    status: state === "CASE_CLOSED" ? "RESOLVED" : "OPEN",
    aiAdvisory: { state, analysisGeneration: 2 },
  });
  await client.invalidateQueries({ queryKey: ["moderation"] });
  expect(await screen.findByText(advisoryStates[state][0])).toBeVisible();
  expect(
    screen.queryByText(/High AI risk|Critical AI risk|Possible threatening language/),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Assessment details")).not.toBeInTheDocument();
});

it("hides findings immediately when switching cases, including loading and error", async () => {
  const view = mount(<CaseDetail caseId="first" />);
  expect(await screen.findByText("High AI risk")).toBeVisible();
  let reject!: (reason: unknown) => void;
  vi.mocked(api.getPlatformCase).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  view.rerender(view.wrap(<CaseDetail caseId="second" />));
  expect(screen.getByText("Loading case")).toBeVisible();
  expect(screen.queryByText("High AI risk")).not.toBeInTheDocument();
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  reject({ status: 403 });
  expect(await screen.findByText("Case unavailable")).toBeVisible();
  expect(screen.queryByRole("region", { name: "AI advisory" })).not.toBeInTheDocument();
});

it("hides findings on queue error and empty results, and retries through the existing boundary", async () => {
  vi.mocked(api.listPlatformCases).mockRejectedValueOnce({ status: 500 });
  mount(<CaseQueue />);
  expect(await screen.findByText("Cases unavailable")).toBeVisible();
  expect(screen.queryByText("High AI risk")).not.toBeInTheDocument();
  vi.mocked(api.listPlatformCases).mockResolvedValue({ items: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  expect(await screen.findByText("No cases found")).toBeVisible();
  expect(screen.queryByLabelText("AI advisory")).not.toBeInTheDocument();
});

it("retains the human decision workflow beside the advisory", async () => {
  mount(<CaseDetail caseId="first" />);
  const region = await screen.findByRole("region", { name: "AI advisory" });
  expect(within(region).getByText("High AI risk")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Reported content" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "User reports" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Case actions" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /reanaly/i })).not.toBeInTheDocument();
});
