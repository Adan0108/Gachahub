import type { CosmeticSlot, Rarity } from '../generated/prisma/client';

/**
 * Duplicate refund / takedown compensation in Shards by rarity
 * (docs/plans/economy-and-cosmetics.md Sections 6.6 & 7.3).
 */
export const COSMETIC_REFUND_SHARDS: Record<Rarity, number> = {
  DUST: 5,
  GLINT: 10,
  GLIMMER: 30,
  RADIANT: 80,
  PRISMATIC: 300,
};

/** Only 4★ (RADIANT) and 5★ (PRISMATIC) items may be animated (Section 6.2). */
export function canCosmeticBeAnimated(rarity: Rarity): boolean {
  return rarity === 'RADIANT' || rarity === 'PRISMATIC';
}

export interface StarterCosmeticSeed {
  id: string;
  slug: string;
  name: string;
  description: string;
  slot: CosmeticSlot;
  rarity: Rarity;
  animated: boolean;
  presetId: string;
}

/**
 * 20 CSS starter cosmetics (Section 15 Phase 2):
 * 6 frames, 6 profile backgrounds, 4 mini backgrounds, 4 banners.
 */
export const STARTER_COSMETIC_CATALOG: readonly StarterCosmeticSeed[] = [
  // 6 Frames (3 GLIMMER, 2 RADIANT, 1 PRISMATIC)
  {
    id: 'csm_frame_starlight_ring',
    slug: 'frame-starlight-ring',
    name: 'Starlight Ring',
    description: 'A crisp sapphire ring spun from quiet night-sky starlight.',
    slot: 'FRAME',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'frame-starlight-ring',
  },
  {
    id: 'csm_frame_verdant_bloom',
    slug: 'frame-verdant-bloom',
    name: 'Verdant Bloom',
    description: 'Dew-bright emerald trim with a subtle botanical crest.',
    slot: 'FRAME',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'frame-verdant-bloom',
  },
  {
    id: 'csm_frame_ember_crest',
    slug: 'frame-ember-crest',
    name: 'Ember Crest',
    description: 'Warm forged copper and hearthfire gold around your portrait.',
    slot: 'FRAME',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'frame-ember-crest',
  },
  {
    id: 'csm_frame_astral_orbit',
    slug: 'frame-astral-orbit',
    name: 'Astral Orbit',
    description:
      'Twin violet-cyan orbital rings that drift in a slow celestial pulse.',
    slot: 'FRAME',
    rarity: 'RADIANT',
    animated: true,
    presetId: 'frame-astral-orbit',
  },
  {
    id: 'csm_frame_nebula_halo',
    slug: 'frame-nebula-halo',
    name: 'Nebula Halo',
    description:
      'Luminous magenta and deep-space indigo threads that shimmer softly.',
    slot: 'FRAME',
    rarity: 'RADIANT',
    animated: true,
    presetId: 'frame-nebula-halo',
  },
  {
    id: 'csm_frame_prismatic_crown',
    slug: 'frame-prismatic-crown',
    name: 'Prismatic Crown',
    description: 'A full-spectrum golden aura reserved for the rarest pulls.',
    slot: 'FRAME',
    rarity: 'PRISMATIC',
    animated: true,
    presetId: 'frame-prismatic-crown',
  },

  // 6 Profile Backgrounds (3 GLIMMER, 2 RADIANT, 1 PRISMATIC)
  {
    id: 'csm_pbg_twilight_observatory',
    slug: 'pbg-twilight-observatory',
    name: 'Twilight Observatory',
    description: 'High-altitude indigo skies over a quiet stargazing dome.',
    slot: 'PROFILE_BACKGROUND',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'pbg-twilight-observatory',
  },
  {
    id: 'csm_pbg_seafoam_sanctuary',
    slug: 'pbg-seafoam-sanctuary',
    name: 'Seafoam Sanctuary',
    description: 'Calm pelagic teal currents and sunlit reef mist.',
    slot: 'PROFILE_BACKGROUND',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'pbg-seafoam-sanctuary',
  },
  {
    id: 'csm_pbg_crimson_archive',
    slug: 'pbg-crimson-archive',
    name: 'Crimson Archive',
    description:
      'Velvet carmine and warm brass lantern glow from an ancient library.',
    slot: 'PROFILE_BACKGROUND',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'pbg-crimson-archive',
  },
  {
    id: 'csm_pbg_aurora_drift',
    slug: 'pbg-aurora-drift',
    name: 'Aurora Drift',
    description:
      'Ribbons of polar emerald and violet drifting across the zenith.',
    slot: 'PROFILE_BACKGROUND',
    rarity: 'RADIANT',
    animated: true,
    presetId: 'pbg-aurora-drift',
  },
  {
    id: 'csm_pbg_void_constellation',
    slug: 'pbg-void-constellation',
    name: 'Void Constellation',
    description: 'Deep astral amethyst with slowly breathing starfield nodes.',
    slot: 'PROFILE_BACKGROUND',
    rarity: 'RADIANT',
    animated: true,
    presetId: 'pbg-void-constellation',
  },
  {
    id: 'csm_pbg_celestial_convergence',
    slug: 'pbg-celestial-convergence',
    name: 'Celestial Convergence',
    description:
      'A radiant golden-prism horizon where three constellations align.',
    slot: 'PROFILE_BACKGROUND',
    rarity: 'PRISMATIC',
    animated: true,
    presetId: 'pbg-celestial-convergence',
  },

  // 4 Mini Backgrounds (2 GLIMMER, 1 RADIANT, 1 PRISMATIC)
  {
    id: 'csm_mbg_cobalt_dusk',
    slug: 'mbg-cobalt-dusk',
    name: 'Cobalt Dusk',
    description: 'Clean cobalt and slate dusk wash for your hover card.',
    slot: 'MINI_BACKGROUND',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'mbg-cobalt-dusk',
  },
  {
    id: 'csm_mbg_rose_quartz',
    slug: 'mbg-rose-quartz',
    name: 'Rose Quartz',
    description: 'Soft rose-gold and plum facets behind your mini profile.',
    slot: 'MINI_BACKGROUND',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'mbg-rose-quartz',
  },
  {
    id: 'csm_mbg_starfall_veil',
    slug: 'mbg-starfall-veil',
    name: 'Starfall Veil',
    description:
      'Shimmering violet-indigo stardust across your mini profile card.',
    slot: 'MINI_BACKGROUND',
    rarity: 'RADIANT',
    animated: true,
    presetId: 'mbg-starfall-veil',
  },
  {
    id: 'csm_mbg_sovereign_aether',
    slug: 'mbg-sovereign-aether',
    name: 'Sovereign Aether',
    description:
      'Iridescent gold and prismatic aether currents for your hover card.',
    slot: 'MINI_BACKGROUND',
    rarity: 'PRISMATIC',
    animated: true,
    presetId: 'mbg-sovereign-aether',
  },

  // 4 Banners (2 GLIMMER, 1 RADIANT, 1 PRISMATIC)
  {
    id: 'csm_bnr_horizon_stride',
    slug: 'bnr-horizon-stride',
    name: 'Horizon Stride',
    description: 'A sweeping azure-and-indigo horizon ribbon.',
    slot: 'BANNER',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'bnr-horizon-stride',
  },
  {
    id: 'csm_bnr_gilded_dawn',
    slug: 'bnr-gilded-dawn',
    name: 'Gilded Dawn',
    description: 'Warm amber daybreak cresting over distant peaks.',
    slot: 'BANNER',
    rarity: 'GLIMMER',
    animated: false,
    presetId: 'bnr-gilded-dawn',
  },
  {
    id: 'csm_bnr_eclipse_corona',
    slug: 'bnr-eclipse-corona',
    name: 'Eclipse Corona',
    description: 'A slow-pulsing amethyst corona around a total solar eclipse.',
    slot: 'BANNER',
    rarity: 'RADIANT',
    animated: true,
    presetId: 'bnr-eclipse-corona',
  },
  {
    id: 'csm_bnr_supernova_anthem',
    slug: 'bnr-supernova-anthem',
    name: 'Supernova Anthem',
    description: 'A blazing prismatic shockwave of gold, rose, and starlight.',
    slot: 'BANNER',
    rarity: 'PRISMATIC',
    animated: true,
    presetId: 'bnr-supernova-anthem',
  },
];

export const EQUIPPED_COSMETIC_ITEM_SELECT = {
  id: true,
  slug: true,
  name: true,
  slot: true,
  rarity: true,
  animated: true,
  assetUrl: true,
  presetId: true,
  active: true,
} as const;

export const EQUIPPED_FRAME_RELATION_SELECT = {
  where: { slot: 'FRAME' as const },
  select: {
    slot: true,
    item: {
      select: EQUIPPED_COSMETIC_ITEM_SELECT,
    },
  },
} as const;

export const ALL_EQUIPPED_COSMETICS_SELECT = {
  select: {
    slot: true,
    item: {
      select: EQUIPPED_COSMETIC_ITEM_SELECT,
    },
  },
} as const;

export interface EquippedCosmeticSummary {
  id: string;
  slug: string;
  name: string;
  slot: CosmeticSlot;
  rarity: Rarity;
  animated: boolean;
  assetUrl: string | null;
  presetId: string | null;
}

export interface EquippedSlotsMap {
  frame: EquippedCosmeticSummary | null;
  profileBackground: EquippedCosmeticSummary | null;
  miniBackground: EquippedCosmeticSummary | null;
  banner: EquippedCosmeticSummary | null;
}

type RawEquippedRow = {
  slot: CosmeticSlot;
  item: {
    id: string;
    slug: string;
    name: string;
    slot: CosmeticSlot;
    rarity: Rarity;
    animated: boolean;
    assetUrl: string | null;
    presetId: string | null;
    active?: boolean;
  } | null;
};

function toSummary(
  item: RawEquippedRow['item'],
): EquippedCosmeticSummary | null {
  if (!item || item.active === false) return null;
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    slot: item.slot,
    rarity: item.rarity,
    animated: item.animated,
    assetUrl: item.assetUrl,
    presetId: item.presetId,
  };
}

export function toEquippedSlotsMap(
  rows?: RawEquippedRow[] | null,
): EquippedSlotsMap {
  const map: EquippedSlotsMap = {
    frame: null,
    profileBackground: null,
    miniBackground: null,
    banner: null,
  };
  if (!rows) return map;
  for (const row of rows) {
    const summary = toSummary(row.item);
    if (!summary) continue;
    switch (row.slot) {
      case 'FRAME':
        map.frame = summary;
        break;
      case 'PROFILE_BACKGROUND':
        map.profileBackground = summary;
        break;
      case 'MINI_BACKGROUND':
        map.miniBackground = summary;
        break;
      case 'BANNER':
        map.banner = summary;
        break;
    }
  }
  return map;
}

export function toEquippedFrameOnly(rows?: RawEquippedRow[] | null): {
  frame: EquippedCosmeticSummary | null;
} {
  if (!rows) return { frame: null };
  const frameRow = rows.find((r) => r.slot === 'FRAME');
  return { frame: frameRow ? toSummary(frameRow.item) : null };
}
