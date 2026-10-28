"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FiCamera, FiCheck, FiEdit2, FiX } from "react-icons/fi";
import { IMAGE_ACCEPT, useImageUpload } from "../../hooks/useImageUpload";
import { api } from "../../lib/api";
import { AvatarFace } from "../AvatarFace";

type GroupConversation = { id: string; title?: string | null; photoUrl?: string | null };

/** The group's picture and name at the top of the info panel; owners and admins change them right there. */
export function GroupIdentity({
  conversation,
  canManage,
  onChanged,
}: {
  conversation: GroupConversation;
  canManage: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const conversationId = conversation.id;

  const photo = useImageUpload({
    purpose: "GROUP_PHOTO",
    currentUrl: conversation.photoUrl,
    save: (mediaUploadId: string) => api.setGroupPhoto(conversationId, mediaUploadId),
    getUrl: (saved: unknown) => (saved as { photoUrl?: string | null }).photoUrl,
    onSaved: onChanged,
  });
  const removePhoto = useMutation({
    mutationFn: () => api.removeGroupPhoto(conversationId),
    onSuccess: onChanged,
  });
  const rename = useMutation({
    mutationFn: (title: string) => api.updateGroupChat(conversationId, { title }),
    onSuccess: async () => {
      setIsRenaming(false);
      await onChanged?.();
    },
  });

  const busy = photo.isPending || removePhoto.isPending;
  const failure =
    photo.error || (removePhoto.isError ? removePhoto.error.message || "Could not remove it" : null);
  const name = conversation.title || "Group chat";
  const canSave = draft.trim() && draft.trim() !== conversation.title && !rename.isPending;

  const startRename = () => {
    rename.reset();
    setDraft(conversation.title || "");
    setIsRenaming(true);
  };
  const saveName = () => {
    if (canSave) rename.mutate(draft.trim());
  };

  return (
    <>
      <div
        className={`chat-info-photo ${isDragging ? "dragging" : ""}`}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          if (!canManage) return;
          event.preventDefault();
          setIsDragging(true);
        }}
        onDrop={(event) => {
          if (!canManage) return;
          event.preventDefault();
          setIsDragging(false);
          if (!busy) photo.pickDropped(event.dataTransfer.files);
        }}
      >
        <span className="chat-avatar large">
          <AvatarFace image={photo.displayUrl} name={name} />
        </span>
        {canManage && (
          <>
            <button
              aria-label="Change group photo"
              className="chat-info-photo-button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              <FiCamera aria-hidden="true" />
            </button>
            <input accept={IMAGE_ACCEPT} hidden onChange={photo.pickFile} ref={inputRef} type="file" />
          </>
        )}
      </div>

      {isRenaming ? (
        <div className="chat-info-rename">
          <input
            aria-label="Group name"
            autoFocus
            maxLength={80}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveName();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setIsRenaming(false);
              }
            }}
            value={draft}
          />
          <button aria-label="Save group name" disabled={!canSave} onClick={saveName} type="button">
            <FiCheck />
          </button>
          <button aria-label="Cancel" onClick={() => setIsRenaming(false)} type="button">
            <FiX />
          </button>
        </div>
      ) : (
        <span className="chat-info-name">
          <b title={name}>{name}</b>
          {canManage && (
            <button aria-label="Change group name" onClick={startRename} type="button">
              <FiEdit2 />
            </button>
          )}
        </span>
      )}
      {rename.isError && (
        <small className="chat-info-error" role="alert">
          {rename.error.message || "Could not change the name"}
        </small>
      )}

      {canManage && conversation.photoUrl && (
        <button className="chat-info-link" disabled={busy} onClick={() => removePhoto.mutate()} type="button">
          Remove photo
        </button>
      )}
      {failure && (
        <small className="chat-info-error" role="alert">
          {failure}
        </small>
      )}
    </>
  );
}
