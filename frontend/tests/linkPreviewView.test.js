import { describe, expect, it } from "vitest";
import { previewDomain, previewDomainLine, previewImageSrc, previewThumbSource } from "../lib/chat/linkPreviewView";

describe("previewDomain", () => {
  it("is the site the link goes to", () => {
    expect(previewDomain("https://www.example.com/a?b=1")).toBe("www.example.com");
  });

  it("is the xn-- form for a non-latin name", () => {
    expect(previewDomain("https://bücher.example/")).toBe("xn--bcher-kva.example");
  });

  it("is empty for something that is not an address", () => {
    expect(previewDomain("not a link")).toBe("");
  });
});

describe("previewDomainLine", () => {
  it("names nothing for an ordinary site, since the message already shows the address", () => {
    expect(previewDomainLine("example.com", null)).toBeNull();
    expect(previewDomainLine("www.youtube.com", null)).toBeNull();
  });

  it("names nothing when a link redirects within the same site", () => {
    expect(previewDomainLine("example.com", "example.com")).toBeNull();
  });

  it("shows where a link really leads when it goes elsewhere", () => {
    expect(previewDomainLine("bit.ly", "destination.example")).toBe("bit.ly → destination.example");
  });

  it.each([["xn--pypal-4ve.com"], ["www.xn--bcher-kva.example"], ["shop.xn--80ak6aa92e.com"]])(
    "names a non-latin site, %s, because the message's own text could pass for another",
    (domain) => {
      expect(previewDomainLine(domain, null)).toBe(domain);
    },
  );

  it("does not mistake a name that merely contains xn-- for a non-latin one", () => {
    expect(previewDomainLine("axn--b.example.com", null)).toBeNull();
  });
});

describe("previewThumbSource", () => {
  const thumb = { blob: "upload-1", key: "k", iv: "i", sha256: "s", width: 320, height: 180 };

  it("finds the picture among the message's attachments", () => {
    expect(
      previewThumbSource("m1", { url: "https://example.com/", thumb }, [
        { mediaUploadId: "other", url: "https://cdn.example/other" },
        { mediaUploadId: "upload-1", url: "https://cdn.example/thumb" },
      ]),
    ).toEqual({ cacheKey: "m1:link-preview:thumb", url: "https://cdn.example/thumb", ref: thumb, mime: "image/jpeg" });
  });

  it("has nothing for a card with no picture", () => {
    expect(previewThumbSource("m1", { url: "https://example.com/" }, [{ mediaUploadId: "upload-1", url: "x" }])).toBeNull();
  });

  it("has nothing when the message has no attachment for it", () => {
    expect(previewThumbSource("m1", { url: "https://example.com/", thumb }, [])).toBeNull();
    expect(previewThumbSource("m1", { url: "https://example.com/", thumb }, undefined)).toBeNull();
  });
});

describe("previewImageSrc", () => {
  it("is a data address for the server's picture", () => {
    expect(previewImageSrc({ mime: "image/png", data: "AAAA" })).toBe("data:image/png;base64,AAAA");
  });

  it("is nothing when there is no picture", () => {
    expect(previewImageSrc(null)).toBeUndefined();
  });
});
