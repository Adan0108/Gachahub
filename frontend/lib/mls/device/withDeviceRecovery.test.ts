import { describe, expect, it, vi } from "vitest";
import { withDeviceRecovery } from "./withDeviceRecovery";

describe("withDeviceRecovery", () => {
  it("returns what the action returns", async () => {
    const reprovision = vi.fn();

    await expect(withDeviceRecovery(async () => "sent", reprovision)).resolves.toBe("sent");
    expect(reprovision).not.toHaveBeenCalled();
  });

  it("passes an ordinary failure straight through, without touching the device", async () => {
    const failure = new Error("network");
    const reprovision = vi.fn();

    await expect(withDeviceRecovery(() => Promise.reject(failure), reprovision)).rejects.toBe(
      failure,
    );
    expect(reprovision).not.toHaveBeenCalled();
  });

  it.each(["DEVICE_REVOKED", "SESSION_NOT_LINKED"])(
    "reconnects the device after %s and asks the user to try again",
    async (code) => {
      const reprovision = vi.fn().mockResolvedValue({ deviceId: "d2" });

      await expect(
        withDeviceRecovery(
          () => Promise.reject(Object.assign(new Error("x"), { code })),
          reprovision,
        ),
      ).rejects.toThrow(/needed to be reconnected/);
      expect(reprovision).toHaveBeenCalledTimes(1);
    },
  );

  it("says so when the device could not be reconnected", async () => {
    const reprovision = vi.fn().mockResolvedValue(undefined);

    await expect(
      withDeviceRecovery(
        () => Promise.reject(Object.assign(new Error("x"), { code: "DEVICE_REVOKED" })),
        reprovision,
      ),
    ).rejects.toThrow(/Couldn't reconnect/);
  });
});
