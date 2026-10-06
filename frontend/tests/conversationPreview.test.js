import { describe, expect, it } from "vitest";
import { previewLine, unsentPreview } from "../lib/chat/conversationPreview";
import { typingLabel } from "../lib/chat/chatDisplay";

const KEY = "A".repeat(43) + "=";
const file = (name, mime) => ({ name, mime, size: 10, blob: name, key: KEY, iv: "A".repeat(16), sha256: KEY });
const attachment = (files, body) => ({ v: 1, type: "attachment", body, files });

describe("previewLine", () => {
  it("shows the text of a message", () => {
    expect(previewLine({ type: "text", body: "Ok :>" }, { mine: false })).toBe("Ok :>");
  });

  it("prefixes your own messages", () => {
    expect(previewLine({ type: "text", body: "hello world" }, { mine: true })).toBe("You: hello world");
  });

  it("collapses line breaks and extra spaces onto one line", () => {
    expect(previewLine({ type: "text", body: "  hi \n\n  there  " }, { mine: false })).toBe("hi there");
  });

  it("names a lone photo, video, or file", () => {
    expect(previewLine(attachment([file("a.png", "image/png")]), { mine: false })).toBe("Sent a photo");
    expect(previewLine(attachment([file("a.mp4", "video/mp4")]), { mine: false })).toBe("Sent a video");
    expect(previewLine(attachment([file("a.pdf", "application/pdf")]), { mine: false })).toBe("Sent a file");
  });

  it("counts several attachments", () => {
    const files = [file("a.png", "image/png"), file("b.png", "image/png")];
    expect(previewLine(attachment(files), { mine: false })).toBe("Sent 2 attachments");
  });

  it("prefers the caption over the attachment label", () => {
    expect(previewLine(attachment([file("a.png", "image/png")], "look"), { mine: true })).toBe("You: look");
  });

  it("returns null for anything unreadable or blank", () => {
    expect(previewLine({ type: "mystery" }, { mine: false })).toBeNull();
    expect(previewLine(null, { mine: false })).toBeNull();
    expect(previewLine({ type: "text", body: "   " }, { mine: false })).toBeNull();
  });
});

describe("unsentPreview", () => {
  it("words it for who unsent", () => {
    expect(unsentPreview({ mine: true })).toBe("You unsent a message");
    expect(unsentPreview({ mine: false })).toBe("Message unsent");
  });
});

describe("typingLabel", () => {
  it("names one, two, or many", () => {
    expect(typingLabel(["Mado"])).toBe("Mado is typing...");
    expect(typingLabel(["Mado", "Rover"])).toBe("Mado and Rover are typing...");
    expect(typingLabel(["Mado", "Rover", "Sora"])).toBe("Mado and 2 others are typing...");
  });
});
