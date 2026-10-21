import { conversationImage, otherActiveMemberIds } from "./chatDisplay";
import { shareStatus, shareTargets } from "./shareTargets";

/** The chats you can pick, narrowed by the search text, plus people found by search who you have not messaged yet. */
export function buildTiles({ conversations, userId, query, found, picked }) {
  const chatTiles = shareTargets(conversations, userId, query).map((target) => ({
    key: `chat:${target.conversation.id}`,
    name: target.name,
    image: conversationImage(target.conversation, userId),
    conversation: target.conversation,
    ok: target.ok,
    reason: target.ok ? null : target.reason,
  }));

  const directByPeer = new Map();
  for (const conversation of conversations || []) {
    if (conversation.type !== "DIRECT") continue;
    for (const peerId of otherActiveMemberIds(conversation, userId))
      directByPeer.set(peerId, conversation);
  }

  const tiles = [...chatTiles];
  const known = new Set(tiles.map((tile) => tile.key));

  for (const person of found) {
    if (person.id === userId) continue;
    const conversation = directByPeer.get(person.id);
    if (conversation) {
      const key = `chat:${conversation.id}`;
      if (known.has(key)) continue;
      const status = shareStatus(conversation, userId);
      tiles.push({
        key,
        name: person.name,
        image: person.image ?? null,
        conversation,
        ok: status.ok,
        reason: status.ok ? null : status.reason,
      });
      known.add(key);
      continue;
    }
    const key = `person:${person.id}`;
    if (known.has(key)) continue;
    tiles.push({
      key,
      name: person.name,
      image: person.image ?? null,
      person: { id: person.id, name: person.name },
      ok: true,
      reason: null,
    });
    known.add(key);
  }

  // People already picked stay on screen even after the search text changes.
  const missing = picked.filter((tile) => !known.has(tile.key));
  return [...missing.map((tile) => ({ ...tile, ok: true, reason: null })), ...tiles];
}
