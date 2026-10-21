import { describe, expect, it } from "vitest";
import { dragVerdict } from "./dragVerdict";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const file = (type: string) => ({ kind: "file", type });

describe("dragVerdict", () => {
  it("says nothing when no file is being dragged", () => {
    expect(dragVerdict([{ kind: "string", type: "text/plain" }], 4, ACCEPTED)).toBeNull();
    expect(dragVerdict(undefined, 4, ACCEPTED)).toBeNull();
  });

  it("welcomes pictures, counting them", () => {
    expect(dragVerdict([file("image/png")], 4, ACCEPTED)).toEqual({ ok: true, message: "Drop to add this image" });
    expect(dragVerdict([file("image/png"), file("image/gif")], 4, ACCEPTED)).toEqual({
      ok: true,
      message: "Drop to add 2 images",
    });
  });

  it("refuses a file type it does not take, such as a PDF", () => {
    const verdict = dragVerdict([file("application/pdf")], 4, ACCEPTED);

    expect(verdict?.ok).toBe(false);
    expect(verdict?.message).toContain("not supported");
  });

  it("refuses the lot when one of them is not a picture", () => {
    expect(dragVerdict([file("image/png"), file("application/pdf")], 4, ACCEPTED)?.ok).toBe(false);
  });

  it("does not refuse a file whose type the browser cannot tell", () => {
    expect(dragVerdict([file("")], 4, ACCEPTED)?.ok).toBe(true);
  });

  it("refuses when the message is already full, and warns when only some fit", () => {
    expect(dragVerdict([file("image/png")], 0, ACCEPTED)?.ok).toBe(false);
    expect(dragVerdict([file("image/png"), file("image/png"), file("image/png")], 2, ACCEPTED)).toMatchObject({
      ok: true,
      message: expect.stringContaining("Only 2 more"),
    });
  });
});
