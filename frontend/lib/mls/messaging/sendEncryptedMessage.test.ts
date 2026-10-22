import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEncryptedChatMessage, sendEncryptedEdit } from "./sendEncryptedMessage";
import { EncryptedIndexedDbMessagePlaintextStore } from "../storage/messagePlaintextStore";
import { GroupStateUnavailableError } from "../contract/errors";

vi.mock("../../api", () => ({
  api: {
    sendChatMessage: vi.fn(),
    editChatMessage: vi.fn(),
  },
}));

function fakeSyncEngine() {
  return {
    getCurrentEpoch: vi.fn(),
    createGroup: vi.fn(),
    seedNewGroupWithMembers: vi.fn(),
    encryptMessage: vi.fn(),
    reconcileMembership: vi.fn(),
  };
}

// Sends are paced against the server's limit for the whole file; each test runs an hour later, so
// earlier tests' sends never hold it up.
const realNow = Date.now.bind(Date);
let hoursLater = 0;
beforeEach(() => {
  hoursLater += 1;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + hoursLater * 3_600_000);
});

const flushPromises = async () => {
  for (let i = 0; i < 200; i += 1) await Promise.resolve();
};

describe("sendEncryptedChatMessage", () => {
  it("rejects oversized plaintext before consuming an encryption step", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    await expect(
      sendEncryptedChatMessage(
        engine as unknown as Parameters<typeof sendEncryptedChatMessage>[0],
        "device-1",
        "conv-1",
        "user-bob",
        "😀".repeat(4000),
        "too-long",
      ),
    ).rejects.toThrow(/too long/);
    expect(engine.encryptMessage).not.toHaveBeenCalled();
    expect(api.sendChatMessage).not.toHaveBeenCalled();
  });

  it("does not submit ciphertext over the server cap", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array(15001), epoch: 2 });
    await expect(
      sendEncryptedChatMessage(
        engine as unknown as Parameters<typeof sendEncryptedChatMessage>[0],
        "device-1",
        "conv-1",
        "user-bob",
        "hello",
        "large-wire",
      ),
    ).rejects.toThrow(/Encrypted message is too large/);
    expect(api.sendChatMessage).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("encrypts, sends, and caches the plaintext when a group already exists", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1, 2, 3]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({
      message: { id: "msg-1" },
    });

    const result = await sendEncryptedChatMessage(
      engine as any,
      "device-1",
      "conv-1",
      "user-bob",
      "hello",
      "client-1",
    );

    expect(engine.createGroup).not.toHaveBeenCalled();
    expect(engine.encryptMessage).toHaveBeenCalledWith("conv-1", {
      v: 1,
      type: "text",
      body: "hello",
    });
    expect(api.sendChatMessage).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({
        contentType: "TEXT",
        clientMessageId: "client-1",
        encryptionMeta: { senderDeviceId: "device-1" },
      }),
    );
    expect(result.message.id).toBe("msg-1");
  });

  // #98: the server has it, so a local save error must not make the send look failed
  it("still reports a send the server accepted as sent when keeping the local copy fails", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: "msg-9" } });
    const save = vi
      .spyOn(EncryptedIndexedDbMessagePlaintextStore.prototype, "save")
      .mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      sendEncryptedChatMessage(engine as any, "device-1", "conv-1", "user-bob", "hi", "client-9"),
    ).resolves.toMatchObject({ message: { id: "msg-9" } });
    expect(save).toHaveBeenCalled();
  });

  // Spammed sends all at once queued on the server's lock; the last ones timed out here though the server stored them.
  it("sends one message of a conversation at a time, in the order they were sent", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    const answers: Array<() => void> = [];
    vi.mocked(api.sendChatMessage).mockImplementation(
      (_conversationId, payload) =>
        new Promise((resolve) => {
          answers.push(() => resolve({ message: { id: `msg-${payload.clientMessageId}` } }));
        }),
    );

    const first = sendEncryptedChatMessage(engine as any, "device-1", "conv-q", "user-bob", "a", "a");
    const second = sendEncryptedChatMessage(engine as any, "device-1", "conv-q", "user-bob", "b", "b");
    await vi.waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.sendChatMessage).toHaveBeenCalledTimes(1);

    answers.shift()!();
    await expect(first).resolves.toMatchObject({ message: { id: "msg-a" } });
    await vi.waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledTimes(2));
    answers.shift()!();
    await expect(second).resolves.toMatchObject({ message: { id: "msg-b" } });
    expect(vi.mocked(api.sendChatMessage).mock.calls.map(([, payload]) => payload.clientMessageId)).toEqual(["a", "b"]);
  });

  it("sends the same ciphertext again after a timeout, and keeps the text of the message the server stored", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([7]), epoch: 2 });
    vi.mocked(api.sendChatMessage)
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }))
      .mockResolvedValueOnce({ message: { id: "msg-stored" } });

    await expect(
      sendEncryptedChatMessage(engine as any, "device-1", "conv-t", "user-bob", "hi", "client-t"),
    ).resolves.toMatchObject({ message: { id: "msg-stored" } });

    const [firstTry, secondTry] = vi.mocked(api.sendChatMessage).mock.calls.map(([, payload]) => payload);
    expect(secondTry).toEqual(firstTry);
    expect(engine.encryptMessage).toHaveBeenCalledTimes(1);
    const kept = await new EncryptedIndexedDbMessagePlaintextStore().get("msg-stored");
    expect(kept?.envelope).toMatchObject({ type: "text", body: "hi" });
  });

  // Typed a second apart, sends could still reach the server in a rush behind a slow one and be refused.
  it("spaces sends out so the server's limit is never crossed, across conversations too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    const save = vi
      .spyOn(EncryptedIndexedDbMessagePlaintextStore.prototype, "save")
      .mockResolvedValue();
    vi.mocked(api.sendChatMessage).mockImplementation(async (_conversationId, payload) => ({
      message: { id: payload.clientMessageId },
    }));

    const sends = Array.from({ length: 7 }, (_, i) =>
      sendEncryptedChatMessage(engine as any, "device-1", i % 2 ? "conv-p1" : "conv-p2", "user-bob", "x", `p${i}`),
    );
    await flushPromises();
    expect(api.sendChatMessage).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(5_500);
    await flushPromises();
    expect(api.sendChatMessage).toHaveBeenCalledTimes(7);
    await Promise.all(sends);
    save.mockRestore();
    vi.useRealTimers();
  });

  it("does not send again after the server refused the message", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockRejectedValueOnce(
      Object.assign(new Error("Slow down"), { status: 429 }),
    );

    await expect(
      sendEncryptedChatMessage(engine as any, "device-1", "conv-r", "user-bob", "hi", "client-r"),
    ).rejects.toThrow("Slow down");
    expect(api.sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it("sends a link preview card inside the encrypted message and attaches its picture", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: "msg-3" } });
    const preview = {
      url: "https://example.com/post",
      title: "A post",
      thumb: { blob: "upload-9", key: "k", iv: "i", sha256: "s", width: 320, height: 180 },
    };

    await sendEncryptedChatMessage(
      engine as any,
      "device-1",
      "conv-1",
      "user-bob",
      "look https://example.com/post",
      "client-1",
      undefined,
      preview,
    );

    expect(engine.encryptMessage).toHaveBeenCalledWith("conv-1", {
      v: 1,
      type: "text",
      body: "look https://example.com/post",
      previews: [preview],
    });
    expect(api.sendChatMessage).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ media: [{ mediaUploadId: "upload-9", sortOrder: 0 }] }),
    );
  });

  it("attaches nothing for a card with no picture", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: "msg-4" } });

    await sendEncryptedChatMessage(
      engine as any,
      "device-1",
      "conv-1",
      "user-bob",
      "look https://example.com/post",
      "client-1",
      undefined,
      { url: "https://example.com/post", title: "A post" },
    );

    const [, body] = vi.mocked(api.sendChatMessage).mock.calls[0]!;
    expect(body).not.toHaveProperty("media");
  });

  it("sends the mentioned user ids beside the ciphertext, and leaves the field out when there are none", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: "msg-5" } });

    await sendEncryptedChatMessage(engine as any, "device-1", "conv-1", "user-bob", "hi @bob", "client-1", undefined, undefined, ["user-bob"]);
    await sendEncryptedChatMessage(engine as any, "device-1", "conv-1", "user-bob", "hi", "client-2");

    expect(vi.mocked(api.sendChatMessage).mock.calls.at(-2)![1]).toMatchObject({ mentionUserIds: ["user-bob"] });
    expect(vi.mocked(api.sendChatMessage).mock.calls.at(-1)![1]).not.toHaveProperty("mentionUserIds");
  });

  it("sets up the group first when this device has never established one", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch
      .mockRejectedValueOnce(new GroupStateUnavailableError("conv-1"))
      .mockResolvedValueOnce(0);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 0 });
    vi.mocked(api.sendChatMessage).mockResolvedValue({ message: { id: "msg-2" } });

    await sendEncryptedChatMessage(
      engine as any,
      "device-1",
      "conv-1",
      "user-bob",
      "hi",
      "client-1",
    );

    expect(engine.createGroup).toHaveBeenCalledWith("conv-1");
    expect(engine.seedNewGroupWithMembers).toHaveBeenCalledWith("conv-1", ["user-bob"]);
  });

  describe("when a member is still being removed", () => {
    const pendingError = () =>
      Object.assign(new Error("A member is being removed"), {
        status: 409,
        code: "MEMBERSHIP_CHANGE_PENDING",
      });

    it("finishes the removal, then encrypts again under the new epoch and sends once more", async () => {
      const { api } = await import("../../api");
      const engine = fakeSyncEngine();
      engine.getCurrentEpoch.mockResolvedValue(2);
      engine.encryptMessage
        .mockResolvedValueOnce({ wireBytes: new Uint8Array([1]), epoch: 2 })
        .mockResolvedValueOnce({ wireBytes: new Uint8Array([2]), epoch: 3 });
      vi.mocked(api.sendChatMessage)
        .mockRejectedValueOnce(pendingError())
        .mockResolvedValueOnce({ message: { id: "msg-9" } });

      const result = await sendEncryptedChatMessage(
        engine as any,
        "device-1",
        "conv-1",
        "user-bob",
        "hello",
        "client-1",
      );

      expect(engine.reconcileMembership).toHaveBeenCalledWith({ conversationId: "conv-1" });
      expect(engine.encryptMessage).toHaveBeenCalledTimes(2);
      expect(api.sendChatMessage).toHaveBeenCalledTimes(2);
      // both sends carry the same id, so the backend can tell they are one message
      expect(
        vi.mocked(api.sendChatMessage).mock.calls.map(([, body]) => body.clientMessageId),
      ).toEqual(["client-1", "client-1"]);
      expect(result.message.id).toBe("msg-9");
    });

    it("only retries once - a second refusal is surfaced", async () => {
      const { api } = await import("../../api");
      const engine = fakeSyncEngine();
      engine.getCurrentEpoch.mockResolvedValue(2);
      engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
      vi.mocked(api.sendChatMessage).mockRejectedValue(pendingError());

      await expect(
        sendEncryptedChatMessage(
          engine as any,
          "device-1",
          "conv-1",
          "user-bob",
          "hello",
          "client-1",
        ),
      ).rejects.toMatchObject({ code: "MEMBERSHIP_CHANGE_PENDING" });

      expect(engine.reconcileMembership).toHaveBeenCalledTimes(1);
      expect(api.sendChatMessage).toHaveBeenCalledTimes(2);
    });

    it("does not reconcile or retry for any other failure", async () => {
      const { api } = await import("../../api");
      const engine = fakeSyncEngine();
      engine.getCurrentEpoch.mockResolvedValue(2);
      engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
      vi.mocked(api.sendChatMessage).mockRejectedValue(
        Object.assign(new Error("duplicate"), { status: 409 }),
      );

      await expect(
        sendEncryptedChatMessage(
          engine as any,
          "device-1",
          "conv-1",
          "user-bob",
          "hello",
          "client-1",
        ),
      ).rejects.toThrow("duplicate");

      expect(engine.reconcileMembership).not.toHaveBeenCalled();
      expect(api.sendChatMessage).toHaveBeenCalledTimes(1);
    });
  });
});

describe("sendEncryptedEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("encrypts an edit envelope, submits it for the message, and caches it under the edit id", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1, 2, 3]), epoch: 2 });
    vi.mocked(api.editChatMessage).mockResolvedValue({ message: { id: "edit-9" } });

    const result = await sendEncryptedEdit(
      engine as any,
      "device-1",
      "conv-1",
      "user-bob",
      { targetMessageId: "msg-1", text: "fixed", n: 2 },
      "client-edit-1",
    );

    expect(engine.encryptMessage).toHaveBeenCalledWith("conv-1", {
      v: 1,
      type: "edit",
      body: { targetMessageId: "msg-1", text: "fixed", n: 2 },
    });
    expect(api.editChatMessage).toHaveBeenCalledWith("msg-1", {
      ciphertext: expect.any(String),
      encryptionMeta: { senderDeviceId: "device-1" },
      clientMessageId: "client-edit-1",
    });
    expect(api.sendChatMessage).not.toHaveBeenCalled();
    expect(result.message.id).toBe("edit-9");

    const cached = await new EncryptedIndexedDbMessagePlaintextStore().get("edit-9");
    expect(cached?.envelope).toEqual({
      v: 1,
      type: "edit",
      body: { targetMessageId: "msg-1", text: "fixed", n: 2 },
    });
  });

  it("catches up on a pending membership change and tries once more", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.editChatMessage)
      .mockRejectedValueOnce(
        Object.assign(new Error("pending"), { code: "MEMBERSHIP_CHANGE_PENDING" }),
      )
      .mockResolvedValueOnce({ message: { id: "edit-10" } });

    await sendEncryptedEdit(
      engine as any,
      "device-1",
      "conv-1",
      "user-bob",
      { targetMessageId: "msg-1", text: "x", n: 1 },
      "client-edit-2",
    );

    expect(engine.reconcileMembership).toHaveBeenCalledWith({ conversationId: "conv-1" });
    expect(api.editChatMessage).toHaveBeenCalledTimes(2);
  });

  it("does not hide other failures, such as the edit window having closed", async () => {
    const { api } = await import("../../api");
    const engine = fakeSyncEngine();
    engine.getCurrentEpoch.mockResolvedValue(2);
    engine.encryptMessage.mockResolvedValue({ wireBytes: new Uint8Array([1]), epoch: 2 });
    vi.mocked(api.editChatMessage).mockRejectedValue(
      Object.assign(new Error("too late"), { code: "EDIT_WINDOW_CLOSED" }),
    );

    await expect(
      sendEncryptedEdit(
        engine as any,
        "device-1",
        "conv-1",
        "user-bob",
        { targetMessageId: "msg-1", text: "x", n: 1 },
        "client-edit-3",
      ),
    ).rejects.toThrow("too late");
    expect(engine.reconcileMembership).not.toHaveBeenCalled();
  });
});
