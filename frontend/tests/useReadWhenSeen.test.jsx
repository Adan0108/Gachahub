import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadWhenSeen } from "../hooks/chat/useReadWhenSeen";

let observers = [];

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.elements = [];
    this.disconnected = false;
    observers.push(this);
  }
  observe(element) {
    this.elements.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
}

/** Tell the newest observer how much of a message row is in view. */
function show(id, { ratio = 1, height = 40, isIntersecting = ratio > 0 } = {}) {
  const observer = observers.at(-1);
  const target = observer.elements.find((element) => element.id === `chat-message-${id}`);
  act(() => {
    observer.callback([
      { target, isIntersecting, intersectionRatio: ratio, intersectionRect: { height }, rootBounds: { height: 400 } },
    ]);
  });
}

let visibility = "visible";
const setVisibility = (value) => {
  visibility = value;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
};

function setup(initialIds = ["m1", "m2", "m3"], conversationId = "c1") {
  const container = document.createElement("div");
  document.body.append(container);
  const addRows = (ids) =>
    ids.forEach((id) => {
      if (document.getElementById(`chat-message-${id}`)) return;
      const row = document.createElement("div");
      row.id = `chat-message-${id}`;
      container.append(row);
    });
  addRows(initialIds);

  const onRead = vi.fn();
  const view = renderHook(
    ({ ids, conversation }) =>
      useReadWhenSeen({ containerRef: { current: container }, conversationId: conversation, messageIds: ids, onRead }),
    { initialProps: { ids: initialIds, conversation: conversationId } },
  );
  return {
    onRead,
    view,
    update: (props) => {
      addRows(props.ids ?? []);
      view.rerender({ ids: initialIds, conversation: conversationId, ...props });
    },
  };
}

describe("useReadWhenSeen", () => {
  beforeEach(() => {
    observers = [];
    visibility = "visible";
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("reads nothing while no message is on screen, such as when scrolled up in the history", () => {
    const { onRead } = setup();

    show("m3", { ratio: 0, isIntersecting: false });

    expect(onRead).not.toHaveBeenCalled();
  });

  it("reads up to the newest message once it is on screen", () => {
    const { onRead } = setup();

    show("m3");

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith("m3");
  });

  it("reads only up to an older message when only that one is on screen", () => {
    const { onRead } = setup();

    show("m1");

    expect(onRead).toHaveBeenCalledWith("m1");
  });

  it("goes forward as the user scrolls down, and never reports the same or an older message again", () => {
    const { onRead } = setup();
    show("m1");
    show("m2");
    show("m1");
    show("m2");

    expect(onRead.mock.calls.map(([id]) => id)).toEqual(["m1", "m2"]);
  });

  it("does not count a message that is barely in view", () => {
    const { onRead } = setup();

    show("m3", { ratio: 0.2, height: 8 });

    expect(onRead).not.toHaveBeenCalled();
  });

  it("counts a message at least half in view", () => {
    const { onRead } = setup();

    show("m3", { ratio: 0.5 });

    expect(onRead).toHaveBeenCalledWith("m3");
  });

  it("counts a very tall message that fills half the thread, even if it never gets half of itself in view", () => {
    const { onRead } = setup();

    show("m3", { ratio: 0.1, height: 250 });

    expect(onRead).toHaveBeenCalledWith("m3");
  });

  it("reads nothing while the tab is in the background, and reads what is on screen when it comes back", () => {
    visibility = "hidden";
    const { onRead } = setup();

    show("m3");
    expect(onRead).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(onRead).toHaveBeenCalledWith("m3");
  });

  it("stops counting a message once it scrolls out of view", () => {
    const { onRead } = setup();
    show("m2");
    show("m3");
    onRead.mockClear();

    show("m3", { ratio: 0, isIntersecting: false });
    setVisibility("visible");

    expect(onRead).not.toHaveBeenCalled();
  });

  it("reads a new message that arrives while the user is looking at the bottom", () => {
    const { onRead, update } = setup(["m1", "m2"]);
    show("m2");
    onRead.mockClear();

    update({ ids: ["m1", "m2", "m3"] });
    show("m3");

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith("m3");
  });

  it("leaves a new message unread when it arrives while the user is scrolled up", () => {
    const { onRead, update } = setup(["m1", "m2"]);
    show("m1");
    onRead.mockClear();

    update({ ids: ["m1", "m2", "m3"] });
    show("m3", { ratio: 0, isIntersecting: false });

    expect(onRead).not.toHaveBeenCalled();
  });

  it("starts again for a different conversation", () => {
    const { onRead, update } = setup(["m1", "m2"], "c1");
    show("m2");
    onRead.mockClear();

    update({ ids: ["x1", "x2"], conversation: "c2" });
    show("x1");

    expect(onRead).toHaveBeenCalledWith("x1");
  });

  it("watches the thread itself, not the whole page, and lets go when it goes away", () => {
    const { view } = setup();
    const observer = observers.at(-1);

    expect(observer.options.root).toBeInstanceOf(HTMLElement);
    view.unmount();

    expect(observer.disconnected).toBe(true);
  });

  it("does nothing when there are no messages to read", () => {
    const { onRead } = setup([]);

    expect(observers).toHaveLength(0);
    expect(onRead).not.toHaveBeenCalled();
  });

  it("reads everything, as before, in a browser that cannot tell what is on screen", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { onRead } = setup();

    expect(onRead).toHaveBeenCalledWith("m3");
  });
});
