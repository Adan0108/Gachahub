"use client";

import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { FiX } from "react-icons/fi";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";
import { useUpdateProfile } from "../../hooks/profile/useUpdateProfile";
import { FieldLimit } from "../FieldLimit";
import {
  BIO_MAX_CHARS,
  NAME_MAX_CHARS,
  NAME_MIN_CHARS,
  type ProfileOwner,
} from "../../lib/profile/profileView";
import { AvatarEditor, type AvatarChange } from "./AvatarEditor";
import { BannerPicker } from "./BannerPicker";

/** Edit your picture, banner, display name and bio. Nothing is saved until Save changes; closing throws the changes away. */
export function EditProfileDialog({
  user,
  onClose,
  onSaved,
  triggerRef,
}: {
  user: ProfileOwner;
  onClose: () => void;
  onSaved?: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const modalRef = useModalFocusTrap<HTMLFormElement>(true, onClose, triggerRef);
  const save = useUpdateProfile();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(user.name ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [banner, setBanner] = useState(user.bannerPresetId ?? null);
  const [uploading, setUploading] = useState(false);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= NAME_MIN_CHARS && trimmedName.length <= NAME_MAX_CHARS;
  const textChanged = trimmedName !== (user.name ?? "") || bio.trim() !== (user.bio ?? "");
  const bannerChanged = banner !== (user.bannerPresetId ?? null);
  const changed = textChanged || bannerChanged || avatar.kind !== "keep";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid || !changed || uploading) return;
    save.mutate(
      {
        ...(textChanged ? { name: trimmedName, bio: bio.trim() } : {}),
        ...(avatar.kind !== "keep" ? { avatar } : {}),
        ...(bannerChanged ? { bannerPresetId: banner } : {}),
      },
      {
        onSuccess: () => {
          onSaved?.();
          onClose();
        },
      },
    );
  };

  return (
    <div className="modal-backdrop" onClick={save.isPending ? undefined : onClose}>
      <form
        aria-label="Edit profile"
        aria-modal="true"
        className="modal profile-edit-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        ref={modalRef}
        role="dialog"
      >
        <div className="panel-head">
          <h2>Edit profile</h2>
          <button aria-label="Close edit profile" disabled={save.isPending} onClick={onClose} type="button">
            <FiX />
          </button>
        </div>
        {/* Everything is read-only while saving, so nothing changes under a save in flight. */}
        <fieldset className="profile-edit-fields" disabled={save.isPending}>
        <AvatarEditor change={avatar} onChange={setAvatar} onUploadingChange={setUploading} user={user} />
        <BannerPicker onChange={setBanner} value={banner} />
        <label>
          Display name
          <input
            autoFocus
            maxLength={NAME_MAX_CHARS}
            onChange={(event) => setName(event.target.value)}
            ref={nameInputRef}
            value={name}
            aria-describedby="profile-name-limit"
          />
        </label>
        <FieldLimit id="profile-name-limit" max={NAME_MAX_CHARS} value={name} />
        {!nameValid && name.length > 0 && (
          <small className="profile-field-hint" role="alert">
            Use {NAME_MIN_CHARS} to {NAME_MAX_CHARS} characters.
          </small>
        )}
        <label>
          Bio
          <textarea
            maxLength={BIO_MAX_CHARS}
            onChange={(event) => setBio(event.target.value)}
            rows={3}
            value={bio}
            aria-describedby="profile-bio-limit"
          />
        </label>
        <FieldLimit id="profile-bio-limit" max={BIO_MAX_CHARS} value={bio} />
        </fieldset>
        {save.isError && (
          <small className="profile-field-hint error" role="alert">
            {save.error?.message || "Could not save your profile."}
          </small>
        )}
        <button
          className="primary"
          disabled={!nameValid || !changed || uploading || save.isPending}
          type="submit"
        >
          {save.isPending ? "Saving..." : uploading ? "Uploading picture..." : "Save changes"}
        </button>
      </form>
    </div>
  );
}
