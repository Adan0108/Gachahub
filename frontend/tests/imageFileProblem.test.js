import { describe, expect, it } from "vitest";
import { imageFileProblem } from "../hooks/useImageUpload";

const file = (name, type = "", size = 10) => {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
};

describe("imageFileProblem", () => {
  it.each(["a.png", "a.JPG", "a.jpeg", "a.webp", "a.gif"])("takes %s even when the browser gives no type", (name) => {
    expect(imageFileProblem(file(name))).toBeNull();
  });

  it("leaves a file with neither a type nor an extension to the backend", () => {
    expect(imageFileProblem(file("photo"))).toBeNull();
  });

  it("takes an image by its type", () => {
    expect(imageFileProblem(file("photo", "image/png"))).toBeNull();
  });

  it.each([
    ["tool.jar", ""],
    ["tool.jar", "application/java-archive"],
    ["doc.pdf", "application/pdf"],
    ["icon.svg", "image/svg+xml"],
  ])("refuses %s (type %s)", (name, type) => {
    expect(imageFileProblem(file(name, type))).toBe("Use a JPG, PNG, WebP or GIF image");
  });

  it("refuses a picture over 10 MB", () => {
    expect(imageFileProblem(file("big.png", "image/png", 11 * 1024 * 1024))).toBe("Image must be 10 MB or smaller");
  });
});
