import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAttachmentPicker } from "../hooks/chat/useAttachmentPicker";

describe("useAttachmentPicker", () => {
  it("drops the picked files when the open conversation changes", () => {
    const { result, rerender } = renderHook(({ id }) => useAttachmentPicker(id), {
      initialProps: { id: "a" },
    });
    act(() => result.current.add([new File(["x"], "pic.png", { type: "image/png" })]));
    expect(result.current.files).toHaveLength(1);

    rerender({ id: "b" });

    expect(result.current.files).toHaveLength(0);
  });

  it("keeps them while the same conversation stays open", () => {
    const { result, rerender } = renderHook(({ id }) => useAttachmentPicker(id), {
      initialProps: { id: "a" },
    });
    act(() => result.current.add([new File(["x"], "pic.png", { type: "image/png" })]));

    rerender({ id: "a" });

    expect(result.current.files).toHaveLength(1);
  });
});
