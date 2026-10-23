import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { addMessageToCache } from "../lib/chat/messageCache";
import { queryKeys } from "../lib/queries";

const key = queryKeys.chatMessages("c1");
// Sent in this order, one second apart.
const SENT_ORDER = ["old", "mid", "new"];
const message = (id: string) => ({
  id,
  createdAt: `2026-10-22T10:00:0${SENT_ORDER.indexOf(id)}.000Z`,
});
const page = (...ids: string[]) => ({
  items: ids.map(message),
  meta: { nextBeforeMessageId: null },
});

/** A watched messages query whose fetches are answered by hand, in the order they were made. */
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending: Array<(value: unknown) => void> = [];
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  });
  const unsubscribe = observer.subscribe(() => {});
  const ids = () =>
    client.getQueryData<{ items: { id: string }[] }>(key)?.items.map((item) => item.id);
  return { client, pending, unsubscribe, ids };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("addMessageToCache (#95)", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it("keeps a pushed message when an older page fetch finishes after it, then fetches again", async () => {
    const { client, pending, unsubscribe, ids } = setup();
    cleanup = unsubscribe;
    pending.shift()!(page("old"));
    await settle();

    void client.refetchQueries({ queryKey: key });
    await settle();
    const staleFetch = pending.shift()!;
    await addMessageToCache(client, "c1", message("new"));
    staleFetch(page("old", "mid"));
    await settle();

    expect(ids()).toEqual(["old", "new"]);

    // The cancelled fetch would have brought "mid"; the one started after the push still does.
    pending.shift()!(page("old", "mid", "new"));
    await settle();
    expect(ids()).toEqual(["old", "mid", "new"]);
  });

  it("fetches the page again when the push lands before the first page arrived", async () => {
    const { client, pending, unsubscribe, ids } = setup();
    cleanup = unsubscribe;
    await settle();
    const firstFetch = pending.shift()!;

    const added = addMessageToCache(client, "c1", message("new"));
    firstFetch(page("old"));
    await settle();
    pending.shift()!(page("old", "new"));
    await added;

    expect(ids()).toEqual(["old", "new"]);
  });

  it("adds a message once when it arrives both ways", async () => {
    const { client, pending, unsubscribe, ids } = setup();
    cleanup = unsubscribe;
    pending.shift()!(page("old", "new"));
    await settle();

    await addMessageToCache(client, "c1", message("new"));

    expect(ids()).toEqual(["old", "new"]);
  });

  // #101: pushes can arrive out of order; the thread must still read in the order they were sent.
  it("puts a pushed message where it belongs, not just at the end", async () => {
    const { client, pending, unsubscribe, ids } = setup();
    cleanup = unsubscribe;
    pending.shift()!(page("old"));
    await settle();

    await addMessageToCache(client, "c1", message("new"));
    await addMessageToCache(client, "c1", message("mid"));

    expect(ids()).toEqual(["old", "mid", "new"]);
  });
});
