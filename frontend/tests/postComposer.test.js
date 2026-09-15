import { describe, expect, it } from "vitest";
import {
  buildPostPayload,
  getPostMediaError,
  getPostTagError,
  parsePostTags,
} from "../lib/postComposer";

describe("post composer", () => {
  it("rejects a new video when an image is already confirmed", () => {
    const video = new File(["video"], "clip.mp4", { type: "video/mp4" });

    expect(getPostMediaError([video], [{ mediaUploadId: "upload-1", resourceType: "IMAGE" }])).toBe(
      "Images and video cannot be mixed in the same post.",
    );
  });

  it("rejects tags longer than the backend limit before upload", () => {
    const tags = parsePostTags(`Build,${"x".repeat(81)}`);
    expect(getPostTagError(tags)).toBe("Each tag must be 80 characters or fewer.");
  });

  it("builds the expected post payload with confirmed media", () => {
    const payload = buildPostPayload(
      {
        gameId: "wuwa",
        categoryId: "builds",
        title: "  Sanhua build  ",
        content: "  Rotation notes  ",
        type: "BUILD",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        isSpoiler: true,
      },
      ["Sanhua", "Build"],
      [{ mediaUploadId: "upload-1" }],
    );

    expect(payload).toMatchObject({
      gameId: "wuwa",
      categoryId: "builds",
      title: "Sanhua build",
      content: "Rotation notes",
      tags: ["Sanhua", "Build"],
      media: [{ mediaUploadId: "upload-1", sortOrder: 0 }],
    });
  });
});
