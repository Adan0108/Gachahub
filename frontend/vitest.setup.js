import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installTestWebLocks } from "./vitest.locks";

// jsdom doesn't implement scrollIntoView; several chat components call it on mount.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

installTestWebLocks();

afterEach(() => cleanup());
