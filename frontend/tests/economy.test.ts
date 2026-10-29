import { describe, expect, it } from "vitest";
import { ledgerReasonLabel, rankName, rankProgress } from "../lib/economy";

describe("economy display helpers", () => {
  it("names ranks and falls back to the starting rank", () => {
    expect(rankName("NOVA")).toBe("Nova");
    expect(rankName(undefined)).toBe("Stargazer");
  });

  it("measures progress toward the next rank", () => {
    expect(rankProgress(0, "STARGAZER")).toMatchObject({ percent: 0, needed: 100 });
    expect(rankProgress(300, "METEOR")).toMatchObject({ percent: 50, needed: 200 });
    expect(rankProgress(20_000, "GALAXY")).toMatchObject({ next: null, percent: 100, needed: 0 });
  });

  it("labels ledger reasons, keeping unknown ones readable", () => {
    expect(ledgerReasonLabel("DAILY_CHECKIN")).toBe("Daily check-in");
    expect(ledgerReasonLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
