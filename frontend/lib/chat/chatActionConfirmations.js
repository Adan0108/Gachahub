/** What each hard-to-undo chat action asks before it runs, wherever it is offered. */
export const CONFIRMATIONS = {
  block: {
    title: (name) => `Block ${name}?`,
    body: "You won't be able to read or send messages in this chat anymore.",
    confirmLabel: "Block",
    error: "Couldn't block this chat. Try again.",
  },
  delete: {
    title: () => "Delete this chat?",
    body: "It disappears for you only. The other people keep their copy.",
    confirmLabel: "Delete chat",
    error: "Couldn't delete this chat. Try again.",
  },
};
