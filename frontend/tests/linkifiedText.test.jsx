import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LinkifiedText } from "../components/chat/LinkifiedText";

const renderText = (text) => render(<p data-testid="text">{<LinkifiedText text={text} />}</p>);

describe("LinkifiedText", () => {
  it("makes a link clickable, opening in a new tab without handing over the page", () => {
    renderText("go to https://example.com/a now");

    const link = screen.getByRole("link", { name: "https://example.com/a" });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("keeps the text around the link exactly as written", () => {
    renderText("before https://example.com/a, after");

    expect(screen.getByTestId("text")).toHaveTextContent("before https://example.com/a, after");
  });

  it("leaves a sentence's own punctuation outside the link", () => {
    renderText("see https://example.com/a.");

    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/a");
    expect(screen.getByTestId("text")).toHaveTextContent("see https://example.com/a.");
  });

  it("adds a scheme to a bare www address, and still shows it as typed", () => {
    renderText("try www.example.com/page");

    const link = screen.getByRole("link", { name: "www.example.com/page" });
    expect(link).toHaveAttribute("href", "https://www.example.com/page");
  });

  it("makes every link in the text clickable", () => {
    renderText("https://a.example/x and https://b.example/y");

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://a.example/x",
      "https://b.example/y",
    ]);
  });

  it("shows ordinary text with no links in it", () => {
    renderText("just words");

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("text")).toHaveTextContent("just words");
  });

  it.each([
    ["a javascript link", "javascript:alert(1)"],
    ["a data link", "data:text/html,<script>alert(1)</script>"],
    ["a file link", "file:///etc/passwd"],
    ["a link with credentials", "https://paypal.com@evil.example/login"],
  ])("does not make %s clickable", (_name, text) => {
    renderText(text);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows markup as text instead of running it", () => {
    const { container } = renderText('<img src=x onerror="alert(1)"><script>alert(1)</script> https://example.com');

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("text")).toHaveTextContent('<img src=x onerror="alert(1)"><script>alert(1)</script>');
  });
});
