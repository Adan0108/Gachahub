"use client";

import { useRef } from "react";
import Link from "next/link";
import { FiX } from "react-icons/fi";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useFollowList } from "../../hooks/profile/useFollowList";
import { floatingPortal } from "../../hooks/chat/useFloatingPosition";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";
import { AvatarFace } from "../AvatarFace";
import { FollowButton } from "./FollowButton";
import "./ProfileSocial.css";

const TITLES = { followers: "Followers", following: "Following" };
const EMPTY = {
  followers: "No followers yet.",
  following: "Not following anyone yet.",
};

/** Who follows someone, or whom they follow; each row links to that profile and has a follow button. */
export function FollowListDialog({ userId, kind, onClose }) {
  const { user: me } = useCurrentUser();
  const list = useFollowList(userId, kind);
  const openerRef = useRef(null);
  const modalRef = useModalFocusTrap(true, onClose, openerRef);

  return floatingPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        aria-label={TITLES[kind]}
        aria-modal="true"
        className="modal follow-list-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="panel-head">
          <h2>{TITLES[kind]}</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <FiX />
          </button>
        </div>

        <ul className="follow-list">
          {list.people.map((person) => (
            <li key={person.id}>
              <Link className="follow-list-person" href={`/user/${person.id}`} onClick={onClose}>
                <span className="follow-list-avatar">
                  <AvatarFace image={person.image} name={person.name} />
                </span>
                <span className="follow-list-text">
                  <b>{person.name}</b>
                  {person.username && <small>@{person.username}</small>}
                </span>
              </Link>
              {person.id !== me?.id && (
                <FollowButton
                  compact
                  followsYou={person.followsYou}
                  isFollowing={person.isFollowing}
                  userId={person.id}
                />
              )}
            </li>
          ))}
        </ul>

        {list.isLoading && <p className="follow-list-note">Loading...</p>}
        {list.isError && (
          <p className="follow-list-note" role="alert">
            Could not load this list.{" "}
            <button className="follow-list-link" onClick={() => list.retry()} type="button">
              Try again
            </button>
          </p>
        )}
        {!list.isLoading && !list.isError && list.people.length === 0 && (
          <p className="follow-list-note">{EMPTY[kind]}</p>
        )}
        {list.hasMore && (
          <button
            className="follow-list-more"
            disabled={list.isLoadingMore}
            onClick={list.loadMore}
            type="button"
          >
            {list.isLoadingMore ? "Loading..." : "Show more"}
          </button>
        )}
      </div>
    </div>,
  );
}
