import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("uploadPostMedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("confirms successful files and reports only failed files for retry", async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/media/uploads/signatures")) {
        return jsonResponse({
          items: [
            {
              uploadId: "upload-1",
              uploadUrl: "https://upload.test/one",
              apiKey: "key",
              timestamp: 1,
              signature: "signed",
              uploadPreset: "preset",
              folder: "posts",
              publicId: "one",
            },
            {
              uploadId: "upload-2",
              uploadUrl: "https://upload.test/two",
              apiKey: "key",
              timestamp: 1,
              signature: "signed",
              uploadPreset: "preset",
              folder: "posts",
              publicId: "two",
            },
          ],
        });
      }
      if (url === "https://upload.test/one") {
        return jsonResponse({
          asset_id: "asset-1",
          public_id: "one",
          secure_url: "https://res.cloudinary.com/demo/one.jpg",
          version: 1,
          signature: "verified",
          format: "jpg",
          bytes: 100,
          width: 100,
          height: 100,
        });
      }
      if (url === "https://upload.test/two") {
        return jsonResponse({ error: { message: "Upload rejected" } }, 500);
      }
      if (String(url).endsWith("/media/uploads/confirm")) {
        const payload = JSON.parse(options.body);
        expect(payload.items).toHaveLength(1);
        return jsonResponse({
          successful: [
            {
              uploadId: "upload-1",
              result: { mediaUploadId: "upload-1", resourceType: "IMAGE" },
            },
          ],
          failed: [],
          successfulCount: 1,
          failedCount: 0,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.uploadPostMedia([
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
    ]);

    expect(result.successful).toEqual([{ mediaUploadId: "upload-1", resourceType: "IMAGE" }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].file.name).toBe("two.png");
    expect(result.failed[0].error).toBe("Upload rejected");
  });
});
