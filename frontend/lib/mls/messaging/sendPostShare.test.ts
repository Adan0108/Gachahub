import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEncryptedEnvelope } from "./sendEncryptedMessage";
import { sendEncryptedPostShare } from "./sendPostShare";

vi.mock("./sendEncryptedMessage", () => ({ sendEncryptedEnvelope: vi.fn() }));

describe("sendEncryptedPostShare", () => {
  beforeEach(() => vi.mocked(sendEncryptedEnvelope).mockReset());

  it("sends a post-share envelope for the post, to the same recipients and with the same client id", async () => {
    vi.mocked(sendEncryptedEnvelope).mockResolvedValue({ message: { id: "m1" } } as never);
    const engine = {} as never;

    const result = await sendEncryptedPostShare(
      engine,
      "dev1",
      "conv1",
      ["bob"],
      { postId: "cm123abc" },
      "client-1",
    );

    expect(result).toEqual({ message: { id: "m1" } });
    expect(sendEncryptedEnvelope).toHaveBeenCalledWith(
      engine,
      "dev1",
      "conv1",
      ["bob"],
      { v: 1, type: "post-share", postId: "cm123abc" },
      "client-1",
    );
  });

  it("carries the note", async () => {
    await sendEncryptedPostShare(
      {} as never,
      "dev1",
      "conv1",
      "bob",
      { postId: "cm123abc", caption: " hi " },
      "c",
    );

    const envelope = vi.mocked(sendEncryptedEnvelope).mock.calls[0]![4];
    expect(envelope).toMatchObject({ postId: "cm123abc", body: "hi" });
  });
});
