/**
 * Runs a send; if it fails because this device was retired or unlinked, the device is reprovisioned
 * for the next attempt and a plain-language error is thrown. This attempt is not retried.
 */
export async function withDeviceRecovery<T>(
  action: () => Promise<T>,
  reprovision: () => Promise<unknown>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "DEVICE_REVOKED" && code !== "SESSION_NOT_LINKED") throw error;

    if (!(await reprovision())) {
      throw new Error("Couldn't reconnect this device. Try again in a moment.", { cause: error });
    }
    throw new Error(
      "Your device needed to be reconnected. Give it a few seconds to rejoin your conversations, then try sending again.",
      { cause: error },
    );
  }
}
