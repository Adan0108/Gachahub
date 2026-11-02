import { describe, expect, it } from "vitest";
import { ledgerReasonLabel, rankName, rankProgress } from "../lib/economy";

describe("economy display helpers", () => {
  it("names ranks and falls back to the starting rank", () => {
    expect(rankName("NOVA")).toBe("Nova");
    expect(rankName(undefined)).toBe("Stargazer");
  });

  it("measures progress toward the next rank", () => {
    expect(rankProgress(0, 0, "STARGAZER")).toMatchObject({ percent: 0, needed: 1_000 });
    expect(rankProgress(2_500, 0, "METEOR")).toMatchObject({ percent: 50, needed: 1_500 });
    expect(rankProgress(80_000, 5_000, "GALAXY")).toMatchObject({ next: null, percent: 100, needed: 0 });
  });

  it("asks for recent Reputation once lifetime already covers the next rank", () => {
    expect(rankProgress(35_000, 200, "NOVA")).toMatchObject({ needed: 0, recentNeeded: 800 });
  });

  it("labels ledger reasons, keeping unknown ones readable", () => {
    expect(ledgerReasonLabel("DAILY_CHECKIN")).toBe("Daily check-in");
    expect(ledgerReasonLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
