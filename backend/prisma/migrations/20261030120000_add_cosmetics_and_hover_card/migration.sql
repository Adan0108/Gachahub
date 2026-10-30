-- Phase 2: Cosmetics and Hover Mini Profile (docs/plans/economy-and-cosmetics.md)

-- Extend existing enums
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'TAKEDOWN_REFUND';
ALTER TYPE "EconomySource" ADD VALUE IF NOT EXISTS 'COSMETIC';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COSMETIC_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COSMETIC_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COSMETIC_DEACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COSMETIC_GRANTED';
ALTER TYPE "AuditTargetType" ADD VALUE IF NOT EXISTS 'COSMETIC';

-- Create Cosmetics enums
CREATE TYPE "CosmeticSlot" AS ENUM ('FRAME', 'PROFILE_BACKGROUND', 'MINI_BACKGROUND', 'BANNER');
CREATE TYPE "Rarity" AS ENUM ('DUST', 'GLINT', 'GLIMMER', 'RADIANT', 'PRISMATIC');
CREATE TYPE "CosmeticSource" AS ENUM ('PULL', 'SPARK', 'ADMIN');

-- CreateTable: cosmetic_items
CREATE TABLE "cosmetic_items" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "slot" "CosmeticSlot" NOT NULL,
    "rarity" "Rarity" NOT NULL,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "assetUrl" TEXT,
    "presetId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cosmetic_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_cosmetics
CREATE TABLE "user_cosmetics" (
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "CosmeticSource" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("userId","itemId")
);

-- CreateTable: equipped_cosmetics
CREATE TABLE "equipped_cosmetics" (
    "userId" TEXT NOT NULL,
    "slot" "CosmeticSlot" NOT NULL,
    "itemId" TEXT NOT NULL,
    "equippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipped_cosmetics_pkey" PRIMARY KEY ("userId","slot")
);

-- CreateIndex
CREATE UNIQUE INDEX "cosmetic_items_slug_key" ON "cosmetic_items"("slug");
CREATE INDEX "cosmetic_items_slot_active_idx" ON "cosmetic_items"("slot", "active");
CREATE INDEX "user_cosmetics_itemId_idx" ON "user_cosmetics"("itemId");
CREATE INDEX "equipped_cosmetics_itemId_idx" ON "equipped_cosmetics"("itemId");

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "cosmetic_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equipped_cosmetics" ADD CONSTRAINT "equipped_cosmetics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equipped_cosmetics" ADD CONSTRAINT "equipped_cosmetics_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "cosmetic_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed 20 CSS Starter Set Items (6 frames, 6 profile backgrounds, 4 mini backgrounds, 4 banners)
INSERT INTO "cosmetic_items" ("id", "slug", "name", "description", "slot", "rarity", "animated", "assetUrl", "presetId", "active")
VALUES
  -- 6 Frames (3 GLIMMER, 2 RADIANT, 1 PRISMATIC)
  ('csm_frame_starlight_ring', 'frame-starlight-ring', 'Starlight Ring', 'A crisp sapphire ring spun from quiet night-sky starlight.', 'FRAME', 'GLIMMER', false, NULL, 'frame-starlight-ring', true),
  ('csm_frame_verdant_bloom', 'frame-verdant-bloom', 'Verdant Bloom', 'Dew-bright emerald trim with a subtle botanical crest.', 'FRAME', 'GLIMMER', false, NULL, 'frame-verdant-bloom', true),
  ('csm_frame_ember_crest', 'frame-ember-crest', 'Ember Crest', 'Warm forged copper and hearthfire gold around your portrait.', 'FRAME', 'GLIMMER', false, NULL, 'frame-ember-crest', true),
  ('csm_frame_astral_orbit', 'frame-astral-orbit', 'Astral Orbit', 'Twin violet-cyan orbital rings that drift in a slow celestial pulse.', 'FRAME', 'RADIANT', true, NULL, 'frame-astral-orbit', true),
  ('csm_frame_nebula_halo', 'frame-nebula-halo', 'Nebula Halo', 'Luminous magenta and deep-space indigo threads that shimmer softly.', 'FRAME', 'RADIANT', true, NULL, 'frame-nebula-halo', true),
  ('csm_frame_prismatic_crown', 'frame-prismatic-crown', 'Prismatic Crown', 'A full-spectrum golden aura reserved for the rarest pulls.', 'FRAME', 'PRISMATIC', true, NULL, 'frame-prismatic-crown', true),

  -- 6 Profile Backgrounds (3 GLIMMER, 2 RADIANT, 1 PRISMATIC)
  ('csm_pbg_twilight_observatory', 'pbg-twilight-observatory', 'Twilight Observatory', 'High-altitude indigo skies over a quiet stargazing dome.', 'PROFILE_BACKGROUND', 'GLIMMER', false, NULL, 'pbg-twilight-observatory', true),
  ('csm_pbg_seafoam_sanctuary', 'pbg-seafoam-sanctuary', 'Seafoam Sanctuary', 'Calmpelagic teal currents and sunlit reef mist.', 'PROFILE_BACKGROUND', 'GLIMMER', false, NULL, 'pbg-seafoam-sanctuary', true),
  ('csm_pbg_crimson_archive', 'pbg-crimson-archive', 'Crimson Archive', 'Velvet carmine and warm brass lantern glow from an ancient library.', 'PROFILE_BACKGROUND', 'GLIMMER', false, NULL, 'pbg-crimson-archive', true),
  ('csm_pbg_aurora_drift', 'pbg-aurora-drift', 'Aurora Drift', 'Ribbons of polar emerald and violet drifting across the zenith.', 'PROFILE_BACKGROUND', 'RADIANT', true, NULL, 'pbg-aurora-drift', true),
  ('csm_pbg_void_constellation', 'pbg-void-constellation', 'Void Constellation', 'Deep astral amethyst with slowly breathing starfield nodes.', 'PROFILE_BACKGROUND', 'RADIANT', true, NULL, 'pbg-void-constellation', true),
  ('csm_pbg_celestial_convergence', 'pbg-celestial-convergence', 'Celestial Convergence', 'A radiant golden-prism horizon where three constellations align.', 'PROFILE_BACKGROUND', 'PRISMATIC', true, NULL, 'pbg-celestial-convergence', true),

  -- 4 Mini Backgrounds (2 GLIMMER, 1 RADIANT, 1 PRISMATIC)
  ('csm_mbg_cobalt_dusk', 'mbg-cobalt-dusk', 'Cobalt Dusk', 'Clean cobalt and slate dusk wash for your hover card.', 'MINI_BACKGROUND', 'GLIMMER', false, NULL, 'mbg-cobalt-dusk', true),
  ('csm_mbg_rose_quartz', 'mbg-rose-quartz', 'Rose Quartz', 'Soft rose-gold and plum facets behind your mini profile.', 'MINI_BACKGROUND', 'GLIMMER', false, NULL, 'mbg-rose-quartz', true),
  ('csm_mbg_starfall_veil', 'mbg-starfall-veil', 'Starfall Veil', 'Shimmering violet-indigo stardust across your mini profile card.', 'MINI_BACKGROUND', 'RADIANT', true, NULL, 'mbg-starfall-veil', true),
  ('csm_mbg_sovereign_aether', 'mbg-sovereign-aether', 'Sovereign Aether', 'Iridescent gold and prismatic aether currents for your hover card.', 'MINI_BACKGROUND', 'PRISMATIC', true, NULL, 'mbg-sovereign-aether', true),

  -- 4 Banners (2 GLIMMER, 1 RADIANT, 1 PRISMATIC)
  ('csm_bnr_horizon_stride', 'bnr-horizon-stride', 'Horizon Stride', 'A sweeping azure-and-indigo horizon ribbon.', 'BANNER', 'GLIMMER', false, NULL, 'bnr-horizon-stride', true),
  ('csm_bnr_gilded_dawn', 'bnr-gilded-dawn', 'Gilded Dawn', 'Warm amber daybreak cresting over distant peaks.', 'BANNER', 'GLIMMER', false, NULL, 'bnr-gilded-dawn', true),
  ('csm_bnr_eclipse_corona', 'bnr-eclipse-corona', 'Eclipse Corona', 'A slow-pulsing amethyst corona around a total solar eclipse.', 'BANNER', 'RADIANT', true, NULL, 'bnr-eclipse-corona', true),
  ('csm_bnr_supernova_anthem', 'bnr-supernova-anthem', 'Supernova Anthem', 'A blazing prismatic shockwave of gold, rose, and starlight.', 'BANNER', 'PRISMATIC', true, NULL, 'bnr-supernova-anthem', true)
ON CONFLICT ("slug") DO NOTHING;
