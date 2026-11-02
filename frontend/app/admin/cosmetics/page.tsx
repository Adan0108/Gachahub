"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiEdit2, FiGift, FiPlus, FiSlash } from "react-icons/fi";
import { AdminActionDialog } from "../../../components/admin/AdminActionDialog";
import { AdminQueryBoundary } from "../../../components/admin/AdminQueryBoundary";
import { AdminShell } from "../../../components/admin/AdminShell";
import { AdminState } from "../../../components/admin/AdminState";
import { Art } from "../../../components/Art";
import { AvatarFace } from "../../../components/AvatarFace";
import { ProfileHoverCardView } from "../../../components/profile/ProfileHoverCard";
import { useRequireAdmin } from "../../../hooks/admin/useRequireAdmin";
import { useToast } from "../../../hooks/useToast";
import { api } from "../../../lib/api";
import {
  COSMETIC_SLOTS,
  RARITY_META,
  STARTER_PRESET_IDS,
  cosmeticSurface,
  type AdminCosmeticItem,
  type CosmeticRarity,
  type CosmeticSlot,
  type EquippedCosmetic,
} from "../../../lib/cosmetics";
import { queries, queryKeys } from "../../../lib/queries";

const RARITIES: CosmeticRarity[] = ["DUST", "GLINT", "GLIMMER", "RADIANT", "PRISMATIC"];

function canAnimateRarity(rarity: CosmeticRarity) {
  return rarity === "RADIANT" || rarity === "PRISMATIC";
}

export default function AdminCosmeticsPage() {
  const session = useRequireAdmin();
  const queryClient = useQueryClient();
  const { notice, showNotice } = useToast(3000);

  const [slotFilter, setSlotFilter] = useState<string>("");
  const [rarityFilter, setRarityFilter] = useState<string>("");
  const [activeFilter, setActiveFilter] = useState<string>("");

  const [showCreate, setShowCreate] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slot, setSlot] = useState<CosmeticSlot>("FRAME");
  const [rarity, setRarity] = useState<CosmeticRarity>("GLIMMER");
  const [animated, setAnimated] = useState(false);
  const [renderMode, setRenderMode] = useState<"preset" | "asset">("preset");
  const [presetId, setPresetId] = useState<string>(STARTER_PRESET_IDS.FRAME[0]?.id ?? "");
  const [assetUrl, setAssetUrl] = useState("");
  const [uploadingAsset, setUploadingAsset] = useState(false);

  const [editingItem, setEditingItem] = useState<AdminCosmeticItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSlot, setEditSlot] = useState<CosmeticSlot>("FRAME");
  const [editRarity, setEditRarity] = useState<CosmeticRarity>("GLIMMER");
  const [editAnimated, setEditAnimated] = useState(false);
  const [editPresetId, setEditPresetId] = useState("");
  const [editAssetUrl, setEditAssetUrl] = useState("");
  const [editActive, setEditActive] = useState(true);

  const [deactivatingItem, setDeactivatingItem] = useState<AdminCosmeticItem | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");

  const [grantItem, setGrantItem] = useState<AdminCosmeticItem | null>(null);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const queryParams = useMemo(
    () => ({
      ...(slotFilter ? { slot: slotFilter } : {}),
      ...(rarityFilter ? { rarity: rarityFilter } : {}),
      ...(activeFilter ? { active: activeFilter } : {}),
    }),
    [activeFilter, rarityFilter, slotFilter],
  );

  const listQuery = useQuery({
    ...queries.adminCosmetics(queryParams),
    enabled: session.isAdmin,
  });

  const items: AdminCosmeticItem[] = Array.isArray(listQuery.data) ? listQuery.data : listQuery.data?.items ?? [];

  const invalidateCosmetics = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.adminCosmetics.all });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createAdminCosmetic({
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim(),
        slot,
        rarity,
        animated: canAnimateRarity(rarity) ? animated : false,
        presetId: renderMode === "preset" ? presetId.trim() || null : null,
        assetUrl: renderMode === "asset" ? assetUrl.trim() || null : null,
      }),
    onSuccess: () => {
      invalidateCosmetics();
      showNotice("Cosmetic item created");
      setShowCreate(false);
      setSlug("");
      setName("");
      setDescription("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingItem) throw new Error("No item selected");
      const locked = editingItem.ownerCount > 0;
      return api.updateAdminCosmetic(editingItem.id, {
        name: editName.trim(),
        description: editDescription.trim(),
        ...(locked ? {} : { slot: editSlot, rarity: editRarity }),
        animated: canAnimateRarity(locked ? editingItem.rarity : editRarity) ? editAnimated : false,
        presetId: editPresetId.trim() || null,
        assetUrl: editAssetUrl.trim() || null,
        ...(editActive !== editingItem.active ? { active: editActive } : {}),
      });
    },
    onSuccess: () => {
      invalidateCosmetics();
      showNotice("Cosmetic item updated");
      setEditingItem(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () =>
      api.deactivateAdminCosmetic(deactivatingItem!.id, deactivateReason.trim()),
    onSuccess: (result) => {
      invalidateCosmetics();
      showNotice(
        `Item deactivated (${result.refundedOwners ?? 0} owners refunded ${result.refundShardsPerOwner ?? result.refundAmountPerOwner ?? 0} Shards each)`,
      );
      setDeactivatingItem(null);
      setDeactivateReason("");
    },
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      api.grantAdminUserCosmetic(
        grantUserId.trim(),
        grantItem!.id,
        grantReason.trim() || undefined,
      ),
    onSuccess: (result) => {
      invalidateCosmetics();
      showNotice(result.alreadyOwned ? "User already owned this cosmetic" : "Cosmetic granted to user");
      setGrantItem(null);
      setGrantUserId("");
      setGrantReason("");
    },
  });

  const handleUploadAsset = async (event: ChangeEvent<HTMLInputElement>, target: "create" | "edit") => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingAsset(true);
    try {
      const purpose = (target === "create" ? slot : editSlot) === "FRAME" ? "AVATAR" : "BANNER";
      const uploaded = await api.uploadSingleImage(file, purpose);
      if (uploaded?.secureUrl) {
        if (target === "create") setAssetUrl(uploaded.secureUrl);
        else setEditAssetUrl(uploaded.secureUrl);
      }
    } catch (error) {
      showNotice((error as Error)?.message || "Could not upload asset");
    } finally {
      setUploadingAsset(false);
    }
  };

  if (session.isLoading || !session.isAdmin) {
    return <AdminState kind="loading" title="Checking admin access" />;
  }

  const sampleEquippedItem: EquippedCosmetic = {
    id: "preview-item",
    slug: slug || "preview-slug",
    name: name || "Preview Cosmetic",
    slot,
    rarity,
    animated: canAnimateRarity(rarity) ? animated : false,
    presetId: renderMode === "preset" ? presetId || null : null,
    assetUrl: renderMode === "asset" ? assetUrl || null : null,
  };

  const openEdit = (item: AdminCosmeticItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditDescription(item.description);
    setEditSlot(item.slot);
    setEditRarity(item.rarity);
    setEditAnimated(item.animated);
    setEditPresetId(item.presetId ?? "");
    setEditAssetUrl(item.assetUrl ?? "");
    setEditActive(item.active);
  };

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!slug.trim() || !name.trim()) return;
    createMutation.mutate();
  };

  return (
    <AdminShell user={session.user}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">Economy & Cosmetics</span>
          <h1>Cosmetic catalog</h1>
          <p>Manage avatar frames, profile backgrounds, hover card backgrounds, and banners.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="admin-page-count">{items.length} items</span>
          <button
            className="admin-button admin-button-primary"
            onClick={() => setShowCreate((prev) => !prev)}
            type="button"
          >
            <FiPlus /> {showCreate ? "Hide creator" : "Create cosmetic"}
          </button>
        </div>
      </div>

      {showCreate && (
        <section className="admin-panel" style={{ marginBottom: 18, padding: 18 }}>
          <h2>Create cosmetic item</h2>
          <form
            onSubmit={handleCreateSubmit}
            style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, marginTop: 12 }}
          >
            <div className="admin-dialog-fields">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  <span>Slug *</span>
                  <input
                    onChange={(event) => setSlug(event.target.value)}
                    placeholder="e.g. frame-starlight-ring"
                    required
                    value={slug}
                  />
                </label>
                <label>
                  <span>Display name *</span>
                  <input
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Starlight Ring"
                    required
                    value={name}
                  />
                </label>
              </div>

              <label>
                <span>Description</span>
                <input
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Short description shown in inventory"
                  value={description}
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label>
                  <span>Slot</span>
                  <select
                    onChange={(event) => {
                      const nextSlot = event.target.value as CosmeticSlot;
                      setSlot(nextSlot);
                      setPresetId(STARTER_PRESET_IDS[nextSlot][0]?.id ?? "");
                    }}
                    value={slot}
                  >
                    {COSMETIC_SLOTS.map((s) => (
                      <option key={s.slot} value={s.slot}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Rarity</span>
                  <select
                    onChange={(event) => {
                      const nextRarity = event.target.value as CosmeticRarity;
                      setRarity(nextRarity);
                      if (!canAnimateRarity(nextRarity)) setAnimated(false);
                    }}
                    value={rarity}
                  >
                    {RARITIES.map((r) => (
                      <option key={r} value={r}>
                        {RARITY_META[r].stars} {RARITY_META[r].name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22 }}>
                  <input
                    checked={canAnimateRarity(rarity) && animated}
                    disabled={!canAnimateRarity(rarity)}
                    onChange={(event) => setAnimated(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Animated (4★/5★ only)</span>
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12 }}>
                <label>
                  <span>Source type</span>
                  <select
                    onChange={(event) => setRenderMode(event.target.value as "preset" | "asset")}
                    value={renderMode}
                  >
                    <option value="preset">CSS Preset ID</option>
                    <option value="asset">Uploaded Asset URL</option>
                  </select>
                </label>

                {renderMode === "preset" ? (
                  <label>
                    <span>CSS Preset ID</span>
                    <select
                      onChange={(event) => setPresetId(event.target.value)}
                      value={presetId}
                    >
                      {STARTER_PRESET_IDS[slot].map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label} ({preset.id})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    <span>Asset URL or Upload</span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        onChange={(event) => setAssetUrl(event.target.value)}
                        placeholder="https://..."
                        style={{ flex: 1 }}
                        value={assetUrl}
                      />
                      <input
                        accept="image/*"
                        disabled={uploadingAsset}
                        onChange={(event) => handleUploadAsset(event, "create")}
                        type="file"
                      />
                    </div>
                  </label>
                )}
              </div>

              {createMutation.isError && (
                <small className="profile-field-hint error" role="alert">
                  {(createMutation.error as Error)?.message || "Could not create cosmetic."}
                </small>
              )}

              <div>
                <button
                  className="admin-button admin-button-primary"
                  disabled={createMutation.isPending || uploadingAsset}
                  type="submit"
                >
                  {createMutation.isPending ? "Creating..." : "Save cosmetic item"}
                </button>
              </div>
            </div>

            <div>
              <small style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                Live Preview (Hover Card)
              </small>
              <div
                className="profile-hover-popover"
                style={{ position: "relative", zIndex: 1, boxShadow: "none" }}
              >
                <ProfileHoverCardView
                  card={{
                    id: "sample-user",
                    name: name || "Sample Rover",
                    username: "samplerover",
                    image: null,
                    bio: "Previewing cosmetic slot",
                    rank: "SUPERNOVA",
                    reputation: 420,
                    followersCount: 128,
                    followingCount: 14,
                    isFollowing: false,
                    followsYou: true,
                    isBlockedByMe: false,
                    premium: true,
                    equipped: {
                      frame: slot === "FRAME" ? sampleEquippedItem : null,
                      profileBackground: slot === "PROFILE_BACKGROUND" ? sampleEquippedItem : null,
                      miniBackground: slot === "MINI_BACKGROUND" ? sampleEquippedItem : null,
                      banner: slot === "BANNER" ? sampleEquippedItem : null,
                    },
                  }}
                  userId="sample-user"
                  viewerId="admin-viewer"
                />
              </div>
            </div>
          </form>
        </section>
      )}

      <section className="admin-toolbar" aria-label="Cosmetic filters">
        <select
          aria-label="Filter slot"
          onChange={(event) => setSlotFilter(event.target.value)}
          value={slotFilter}
        >
          <option value="">All slots</option>
          {COSMETIC_SLOTS.map((s) => (
            <option key={s.slot} value={s.slot}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter rarity"
          onChange={(event) => setRarityFilter(event.target.value)}
          value={rarityFilter}
        >
          <option value="">All rarities</option>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {RARITY_META[r].stars} {RARITY_META[r].name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter active state"
          onChange={(event) => setActiveFilter(event.target.value)}
          value={activeFilter}
        >
          <option value="">All states</option>
          <option value="true">Active only</option>
          <option value="false">Deactivated only</option>
        </select>
        <span>{items.length} shown</span>
      </section>

      <AdminQueryBoundary
        query={listQuery}
        loading={{ title: "Loading cosmetics", message: "Retrieving cosmetic catalog." }}
        error={{
          title: "Cosmetics unavailable",
          message: (listQuery.error as Error)?.message || "Catalog could not be loaded.",
        }}
        empty={
          !items.length
            ? {
                title: "No cosmetics found",
                message: "No cosmetic items match the current filters.",
              }
            : null
        }
      >
        <section className="admin-panel">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Preview</th>
                  <th>Item</th>
                  <th>Slot</th>
                  <th>Rarity</th>
                  <th>Owners</th>
                  <th>Status</th>
                  <th className="admin-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const rarityMeta = RARITY_META[item.rarity];
                  const presetClass = item.presetId ? `cosmetic-preset-${item.presetId}` : "";
                  return (
                    <tr key={item.id}>
                      <td>
                        <div
                          className={`cosmetic-choice-swatch ${item.slot !== "FRAME" ? presetClass : ""}`.trim()}
                          style={{
                            width: 48,
                            height: 36,
                            ...(item.slot !== "FRAME"
                              ? {
                                  ...cosmeticSurface(item).style,
                                  backgroundSize: "cover",
                                  backgroundPosition: "center",
                                }
                              : {}),
                          }}
                        >
                          {item.slot === "FRAME" && (
                            <div style={{ width: 28, height: 28 }}>
                              <AvatarFace
                                fallback={<Art tone="blue">★</Art>}
                                frame={item}
                                name={item.name}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div>
                          <b>{item.name}</b>
                          <small style={{ display: "block", color: "var(--muted)" }}>
                            {item.slug}
                          </small>
                        </div>
                      </td>
                      <td>
                        <span className="admin-type-badge">{item.slot}</span>
                      </td>
                      <td>
                        <span style={{ color: rarityMeta.color, fontWeight: 700 }}>
                          {rarityMeta.stars} {rarityMeta.name}
                          {item.animated ? " · Animated" : ""}
                        </span>
                      </td>
                      <td>
                        {item.ownerCount} owned ({item.equippedCount} equipped)
                      </td>
                      <td>
                        <span className={`admin-status ${item.active ? "status-active" : "status-suspended"}`}>
                          {item.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            aria-label={`Edit ${item.name}`}
                            className="admin-icon-button"
                            onClick={() => openEdit(item)}
                            title="Edit item"
                            type="button"
                          >
                            <FiEdit2 />
                          </button>
                          <button
                            aria-label={`Grant ${item.name}`}
                            className="admin-icon-button"
                            onClick={() => {
                              setGrantItem(item);
                              setGrantUserId("");
                              setGrantReason("");
                            }}
                            title="Grant to user"
                            type="button"
                          >
                            <FiGift />
                          </button>
                          {item.active && (
                            <button
                              aria-label={`Deactivate ${item.name}`}
                              className="admin-icon-button admin-icon-danger"
                              onClick={() => {
                                setDeactivatingItem(item);
                                setDeactivateReason("");
                              }}
                              title="Deactivate & refund owners"
                              type="button"
                            >
                              <FiSlash />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </AdminQueryBoundary>

      {editingItem && (
        <AdminActionDialog
          confirmDisabled={!editName.trim()}
          confirmLabel="Save changes"
          description={
            editingItem.ownerCount > 0
              ? `Owned by ${editingItem.ownerCount} user(s) — slot and rarity are locked.`
              : "Update cosmetic details."
          }
          error={(updateMutation.error as Error)?.message}
          onClose={() => setEditingItem(null)}
          onConfirm={() => updateMutation.mutate()}
          pending={updateMutation.isPending}
          pendingLabel="Saving..."
          title={`Edit ${editingItem.name}`}
          tone="primary"
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Name *</span>
              <input
                onChange={(event) => setEditName(event.target.value)}
                value={editName}
              />
            </label>
            <label>
              <span>Description</span>
              <input
                onChange={(event) => setEditDescription(event.target.value)}
                value={editDescription}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label>
                <span>Slot {editingItem.ownerCount > 0 ? "(Locked)" : ""}</span>
                <select
                  disabled={editingItem.ownerCount > 0}
                  onChange={(event) => setEditSlot(event.target.value as CosmeticSlot)}
                  value={editSlot}
                >
                  {COSMETIC_SLOTS.map((s) => (
                    <option key={s.slot} value={s.slot}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Rarity {editingItem.ownerCount > 0 ? "(Locked)" : ""}</span>
                <select
                  disabled={editingItem.ownerCount > 0}
                  onChange={(event) => setEditRarity(event.target.value as CosmeticRarity)}
                  value={editRarity}
                >
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {RARITY_META[r].stars} {RARITY_META[r].name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>CSS Preset ID</span>
              <input
                onChange={(event) => setEditPresetId(event.target.value)}
                placeholder="Optional CSS preset id"
                value={editPresetId}
              />
            </label>
            <label>
              <span>Asset URL</span>
              <input
                onChange={(event) => setEditAssetUrl(event.target.value)}
                placeholder="Optional uploaded asset URL"
                value={editAssetUrl}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                checked={editAnimated}
                disabled={!canAnimateRarity(editRarity)}
                onChange={(event) => setEditAnimated(event.target.checked)}
                type="checkbox"
              />
              <span>Animated (4★/5★ only)</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                checked={editActive}
                onChange={(event) => setEditActive(event.target.checked)}
                type="checkbox"
              />
              <span>Active</span>
            </label>
          </div>
        </AdminActionDialog>
      )}

      {deactivatingItem && (
        <AdminActionDialog
          confirmDisabled={!deactivateReason.trim()}
          confirmLabel="Deactivate & refund"
          description={`Deactivating "${deactivatingItem.name}" unequips it from ${deactivatingItem.equippedCount} user(s) and refunds ${deactivatingItem.ownerCount} owner(s) ${RARITY_META[deactivatingItem.rarity].refundShards} Starlight Shards each (TAKEDOWN_REFUND).`}
          error={(deactivateMutation.error as Error)?.message}
          onClose={() => setDeactivatingItem(null)}
          onConfirm={() => deactivateMutation.mutate()}
          pending={deactivateMutation.isPending}
          pendingLabel="Deactivating..."
          title={`Deactivate ${deactivatingItem.name}?`}
          tone="danger"
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Reason *</span>
              <textarea
                onChange={(event) => setDeactivateReason(event.target.value)}
                placeholder="Reason recorded in audit log and wallet ledger"
                rows={3}
                value={deactivateReason}
              />
            </label>
          </div>
        </AdminActionDialog>
      )}

      {grantItem && (
        <AdminActionDialog
          confirmDisabled={!grantUserId.trim()}
          confirmLabel="Grant cosmetic"
          description={`Grant "${grantItem.name}" (${RARITY_META[grantItem.rarity].stars}) directly to a user account.`}
          error={(grantMutation.error as Error)?.message}
          onClose={() => setGrantItem(null)}
          onConfirm={() => grantMutation.mutate()}
          pending={grantMutation.isPending}
          pendingLabel="Granting..."
          title={`Grant ${grantItem.name}`}
          tone="primary"
        >
          <div className="admin-dialog-fields">
            <label>
              <span>Target User ID *</span>
              <input
                onChange={(event) => setGrantUserId(event.target.value)}
                placeholder="User ID"
                value={grantUserId}
              />
            </label>
            <label>
              <span>Reason (optional)</span>
              <input
                onChange={(event) => setGrantReason(event.target.value)}
                placeholder="Audit log note"
                value={grantReason}
              />
            </label>
          </div>
        </AdminActionDialog>
      )}

      {notice ? (
        <div className="toast admin-toast" role="status">
          {notice}
        </div>
      ) : null}
    </AdminShell>
  );
}
