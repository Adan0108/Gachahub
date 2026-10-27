import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatBackup } from "../hooks/chat/useChatBackup";

const mocks = vi.hoisted(() => ({
  status: { enabled: false, keyCheck: null as string | null },
  heldKeyCheck: null as string | null,
  getStatus: vi.fn(),
  enableBackup: vi.fn(),
  resumeBackup: vi.fn(),
}));

vi.mock("../lib/api", () => ({ api: { getChatBackupStatus: mocks.getStatus } }));
vi.mock("../lib/backup/backupKey", () => ({
  generateBackupKey: () => new Uint8Array(32),
  formatRecoveryKey: async () => "KEY",
  parseRecoveryKey: async () => new Uint8Array(32),
}));
vi.mock("../lib/backup/backupRuntime", () => ({
  enableBackup: mocks.enableBackup,
  resumeBackup: mocks.resumeBackup,
  disableBackup: vi.fn(),
  cancelBackupDeletion: vi.fn(),
  scheduleBackupDeletion: vi.fn(),
  restoreOnThisDevice: vi.fn(),
  onBackupDisabledElsewhere: () => () => undefined,
}));

describe("useChatBackup turning backup on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = { enabled: false, keyCheck: null };
    mocks.heldKeyCheck = null;
    mocks.getStatus.mockImplementation(async () => ({ ...mocks.status }));
    mocks.enableBackup.mockImplementation(async () => {
      mocks.heldKeyCheck = "check-1";
      mocks.status = { enabled: true, keyCheck: "check-1" };
    });
    // Like the real one: a status that says "off" wipes the key this browser holds.
    mocks.resumeBackup.mockImplementation(async (_userId: string, status: typeof mocks.status) => {
      if (!status.enabled || status.keyCheck !== mocks.heldKeyCheck) {
        mocks.heldKeyCheck = null;
        return false;
      }
      return true;
    });
  });

  // CFI-003: the browser that made the recovery key then asked for it to restore
  it("keeps the key it just made: this browser holds it afterwards", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChatBackup("me"), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true));

    await act(async () => {
      await result.current.beginEnable();
    });
    // The status refetch after turning it on is slow, so the page re-renders while the cached
    // status still says "off".
    let answer!: () => void;
    mocks.getStatus.mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve({ ...mocks.status }))),
    );
    let enabling!: Promise<void>;
    act(() => {
      enabling = result.current.confirmEnable.mutateAsync();
    });
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.heldKeyCheck).toBe("check-1");
    await act(async () => {
      answer();
      await enabling;
    });

    await waitFor(() => expect(result.current.holdsKey).toBe(true));
    expect(mocks.heldKeyCheck).toBe("check-1");
  });
});
