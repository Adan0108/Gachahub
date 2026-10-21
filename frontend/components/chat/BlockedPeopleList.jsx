"use client";

import { AvatarFace } from "../AvatarFace";

/** Everyone you have blocked, each with Unblock; a person you have a chat with can be opened from here. */
export function BlockedPeopleList({
  people,
  isLoading,
  isError,
  onRetry,
  onUnblock,
  unblockingId,
  chatIdByUserId,
  onOpenChat,
}) {
  if (isLoading) return <p className="chat-blocked-note">Loading...</p>;
  if (isError) {
    return (
      <p className="chat-blocked-note" role="alert">
        Could not load this list.{" "}
        <button className="chat-blocked-link" onClick={onRetry} type="button">
          Try again
        </button>
      </p>
    );
  }
  if (people.length === 0) {
    return <p className="chat-blocked-note">You have not blocked anyone.</p>;
  }

  return (
    <ul aria-label="Blocked people" className="chat-blocked-list">
      {people.map((person) => {
        const chatId = chatIdByUserId.get(person.id);
        return (
          <li key={person.id}>
            <span className="chat-blocked-avatar">
              <AvatarFace image={person.image} name={person.name} />
            </span>
            <span className="chat-blocked-text">
              <b>{person.name}</b>
              {person.username && <small>@{person.username}</small>}
            </span>
            {chatId && (
              <button className="chat-blocked-link" onClick={() => onOpenChat(chatId)} type="button">
                Open chat
              </button>
            )}
            <button
              className="chat-blocked-unblock"
              disabled={unblockingId === person.id}
              onClick={() => onUnblock(person.id)}
              type="button"
            >
              Unblock
            </button>
          </li>
        );
      })}
    </ul>
  );
}
