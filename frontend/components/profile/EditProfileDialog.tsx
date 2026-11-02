"use client";

import { useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiX } from "react-icons/fi";
import { useModalFocusTrap } from "../../hooks/chat/useModalFocusTrap";
import { useUpdateProfile } from "../../hooks/profile/useUpdateProfile";
import { queries } from "../../lib/queries";
import {
  COSMETIC_SLOTS,
  RARITY_META,
  bannerSurface,
  cosmeticSurface,
  resolveBanner,
  type CosmeticSlot,
  type EquippedCosmetic,
} from "../../lib/cosmetics";
import { Art } from "../Art";
import { AvatarFace } from "../AvatarFace";
import { FieldLimit } from "../FieldLimit";
import {
  BIO_MAX_CHARS,
  NAME_MAX_CHARS,
  NAME_MIN_CHARS,
  type ProfileOwner,
} from "../../lib/profile/profileView";
import { AvatarEditor, type AvatarChange } from "./AvatarEditor";
import { BannerPicker } from "./BannerPicker";

type DialogTab = "Profile" | "Cosmetics";

/** Edit your picture, banner, display name, bio, and equipped cosmetics. Nothing is saved until Save changes; closing throws the changes away. */
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
  const [activeTab, setActiveTab] = useState<DialogTab>("Profile");
  const [selectedSlot, setSelectedSlot] = useState<CosmeticSlot>("FRAME");
  const [name, setName] = useState(user.name ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "keep" });
  const [banner, setBanner] = useState(user.bannerPresetId ?? null);
  const [uploading, setUploading] = useState(false);

  const initialEquippedIds = useMemo<Record<CosmeticSlot, string | null>>(
    () => ({
      FRAME: user.equipped?.frame?.id ?? null,
      PROFILE_BACKGROUND: user.equipped?.profileBackground?.id ?? null,
      MINI_BACKGROUND: user.equipped?.miniBackground?.id ?? null,
      BANNER: user.equipped?.banner?.id ?? null,
    }),
    [user.equipped],
  );

  // Only the slots picked in this dialog; every other slot shows what is equipped now.
  const [pickedIds, setPickedIds] = useState<Partial<Record<CosmeticSlot, string | null>>>({});

  const cosmeticsQuery = useQuery({
    ...queries.myCosmetics(),
    enabled: activeTab === "Cosmetics",
  });

  const baselineEquippedIds = useMemo<Record<CosmeticSlot, string | null>>(() => {
    if (cosmeticsQuery.data) {
      const eq = cosmeticsQuery.data.equipped;
      return {
        FRAME: eq.frame?.id ?? null,
        PROFILE_BACKGROUND: eq.profileBackground?.id ?? null,
        MINI_BACKGROUND: eq.miniBackground?.id ?? null,
        BANNER: eq.banner?.id ?? null,
      };
    }
    return initialEquippedIds;
  }, [cosmeticsQuery.data, initialEquippedIds]);
  const draftEquippedIds = useMemo<Record<CosmeticSlot, string | null>>(
    () => ({ ...baselineEquippedIds, ...pickedIds }),
    [baselineEquippedIds, pickedIds],
  );

  const equippedChanges = useMemo(() => {
    const changes: Partial<Record<CosmeticSlot, string | null>> = {};
    for (const { slot } of COSMETIC_SLOTS) {
      if (draftEquippedIds[slot] !== baselineEquippedIds[slot]) {
        changes[slot] = draftEquippedIds[slot];
      }
    }
    return changes;
  }, [baselineEquippedIds, draftEquippedIds]);

  const hasEquippedChanges = Object.keys(equippedChanges).length > 0;

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= NAME_MIN_CHARS && trimmedName.length <= NAME_MAX_CHARS;
  const textChanged = trimmedName !== (user.name ?? "") || bio.trim() !== (user.bio ?? "");
  const bannerChanged = banner !== (user.bannerPresetId ?? null);
  const changed = textChanged || bannerChanged || avatar.kind !== "keep" || hasEquippedChanges;

  const ownedBySlot = useMemo(() => {
    const items = cosmeticsQuery.data?.owned ?? [];
    return items.filter((entry) => entry.item.slot === selectedSlot);
  }, [cosmeticsQuery.data?.owned, selectedSlot]);

  const resolveDraftItem = (slot: CosmeticSlot): EquippedCosmetic | null => {
    const targetId = draftEquippedIds[slot];
    if (!targetId) return null;
    const fromOwned = cosmeticsQuery.data?.owned.find((o) => o.itemId === targetId)?.item;
    if (fromOwned) return fromOwned;
    const slotMeta = COSMETIC_SLOTS.find((s) => s.slot === slot);
    if (!slotMeta) return null;
    return cosmeticsQuery.data?.equipped[slotMeta.key] ?? user.equipped?.[slotMeta.key] ?? null;
  };

  const previewFrame = resolveDraftItem("FRAME");
  const previewProfileBg = resolveDraftItem("PROFILE_BACKGROUND");
  const previewMiniBg = resolveDraftItem("MINI_BACKGROUND");
  const previewBannerItem = resolveDraftItem("BANNER");

  const previewResolvedBanner = resolveBanner({
    premium: user.premium,
    equippedBanner: previewBannerItem,
    bannerPresetId: banner,
  });

  const previewBgItem = selectedSlot === "MINI_BACKGROUND" ? previewMiniBg : previewProfileBg;
  const { className: previewBgPresetClass, style: previewBgStyle } = cosmeticSurface(previewBgItem);
  const { className: previewBannerPresetClass, style: previewBannerStyle } =
    bannerSurface(previewResolvedBanner);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid || !changed || uploading) return;
    save.mutate(
      {
        ...(textChanged ? { name: trimmedName, bio: bio.trim() } : {}),
        ...(avatar.kind !== "keep" ? { avatar } : {}),
        ...(bannerChanged ? { bannerPresetId: banner } : {}),
        ...(hasEquippedChanges ? { equippedChanges } : {}),
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

        <div className="edit-profile-tabs" role="tablist" aria-label="Edit profile sections">
          {(["Profile", "Cosmetics"] as const).map((tabName) => (
            <button
              aria-selected={activeTab === tabName}
              className={`edit-profile-tab-btn ${activeTab === tabName ? "active" : ""}`}
              disabled={save.isPending}
              key={tabName}
              onClick={() => setActiveTab(tabName)}
              role="tab"
              type="button"
            >
              {tabName}
            </button>
          ))}
        </div>

        {/* Everything is read-only while saving, so nothing changes under a save in flight. */}
        <fieldset className="profile-edit-fields" disabled={save.isPending}>
          {activeTab === "Profile" ? (
            <>
              <AvatarEditor
                change={avatar}
                onChange={setAvatar}
                onUploadingChange={setUploading}
                user={user}
              />
              <BannerPicker onChange={setBanner} value={banner} />
              <label>
                Display name
                <input
                  aria-describedby="profile-name-limit"
                  autoFocus
                  maxLength={NAME_MAX_CHARS}
                  onChange={(event) => setName(event.target.value)}
                  ref={nameInputRef}
                  value={name}
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
                  aria-describedby="profile-bio-limit"
                  maxLength={BIO_MAX_CHARS}
                  onChange={(event) => setBio(event.target.value)}
                  rows={3}
                  value={bio}
                />
              </label>
              <FieldLimit id="profile-bio-limit" max={BIO_MAX_CHARS} value={bio} />
            </>
          ) : (
            <div className="cosmetics-tab-layout">
              <div
                aria-label="Cosmetics live preview"
                className={`cosmetics-live-preview ${previewBgPresetClass}`.trim()}
                style={previewBgStyle}
              >
                {previewBgItem && <div className="profile-surface-scrim" aria-hidden="true" />}
                <div
                  className={`cosmetics-live-preview-banner ${previewBannerPresetClass}`.trim()}
                  style={previewBannerStyle}
                />
                <div className="cosmetics-live-preview-body">
                  <div style={{ width: 48, height: 48 }}>
                    <AvatarFace
                      fallback={<Art tone="blue">{(trimmedName || "U").charAt(0).toUpperCase()}</Art>}
                      frame={previewFrame}
                      image={user.image}
                      name={trimmedName}
                    />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{trimmedName || "Display name"}</div>
                    {user.username && (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>@{user.username}</div>
                    )}
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                      Live Preview ({selectedSlot === "MINI_BACKGROUND" ? "Hover Card" : "Profile"})
                    </div>
                  </div>
                </div>
              </div>

              <div className="cosmetics-slot-pills" role="tablist" aria-label="Cosmetic slots">
                {COSMETIC_SLOTS.map(({ slot, label }) => (
                  <button
                    aria-selected={selectedSlot === slot}
                    className={`cosmetics-slot-pill ${selectedSlot === slot ? "active" : ""}`}
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    role="tab"
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {cosmeticsQuery.isLoading ? (
                <div style={{ padding: "12px 0", fontSize: 13, color: "var(--muted)" }}>
                  Loading your cosmetics...
                </div>
              ) : (
                <div className="cosmetics-owned-grid">
                  <button
                    className={`cosmetic-choice-card ${draftEquippedIds[selectedSlot] === null ? "selected" : ""}`}
                    onClick={() =>
                      setPickedIds((prev) => ({
                        ...prev,
                        [selectedSlot]: null,
                      }))
                    }
                    type="button"
                  >
                    <div className="cosmetic-choice-swatch">
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>None</span>
                    </div>
                    <div className="cosmetic-choice-title">None (Unequipped)</div>
                    <div className="cosmetic-choice-rarity" style={{ color: "var(--muted)" }}>
                      Default
                    </div>
                  </button>

                  {ownedBySlot.map(({ item }) => {
                    const rarity = RARITY_META[item.rarity];
                    const isSelected = draftEquippedIds[selectedSlot] === item.id;
                    const swatchPresetClass = item.presetId ? `cosmetic-preset-${item.presetId}` : "";
                    return (
                      <button
                        className={`cosmetic-choice-card ${isSelected ? "selected" : ""}`}
                        key={item.id}
                        onClick={() =>
                          setPickedIds((prev) => ({
                            ...prev,
                            [selectedSlot]: item.id,
                          }))
                        }
                        type="button"
                      >
                        <div
                          className={`cosmetic-choice-swatch ${item.slot !== "FRAME" ? swatchPresetClass : ""}`.trim()}
                          style={
                            item.slot !== "FRAME"
                              ? {
                                  ...cosmeticSurface(item).style,
                                  backgroundSize: "cover",
                                  backgroundPosition: "center",
                                }
                              : undefined
                          }
                        >
                          {item.slot === "FRAME" && (
                            <div style={{ width: 32, height: 32 }}>
                              <AvatarFace
                                fallback={<Art tone="blue">★</Art>}
                                frame={item}
                                image={user.image}
                                name={item.name}
                              />
                            </div>
                          )}
                        </div>
                        <div className="cosmetic-choice-title">{item.name}</div>
                        <div className="cosmetic-choice-rarity" style={{ color: rarity.color }}>
                          {rarity.stars} {rarity.name}
                          {item.animated ? " · Animated" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {!cosmeticsQuery.isLoading && ownedBySlot.length === 0 && (
                <small style={{ color: "var(--muted)", fontSize: 12.5 }}>
                  You don&apos;t own any cosmetics in this slot yet.
                </small>
              )}
            </div>
          )}
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
