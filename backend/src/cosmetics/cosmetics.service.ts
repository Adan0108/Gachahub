import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EconomyService } from '../economy/economy.service';
import type { CosmeticSlot, Prisma, Rarity } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_EQUIPPED_COSMETICS_SELECT,
  COSMETIC_REFUND_SHARDS,
  STARTER_COSMETIC_CATALOG,
  canCosmeticBeAnimated,
  toEquippedSlotsMap,
} from './cosmetic-starter-catalog';
import { CreateCosmeticDto } from './dto/create-cosmetic.dto';
import { UpdateCosmeticDto } from './dto/update-cosmetic.dto';

@Injectable()
export class CosmeticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economyService: EconomyService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Acquires a row-level lock on `cosmetic_items` so concurrent equip, edit,
   * grant, and takedown operations serialize cleanly.
   */
  private async lockCosmeticItem(
    tx: Prisma.TransactionClient,
    itemId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "cosmetic_items" WHERE id = ${itemId} FOR UPDATE`;
  }

  /**
   * Validates Section 6.2 invariants: every cosmetic requires either a CSS
   * presetId or an assetUrl, and only 4★/5★ items may be animated.
   */
  private validateVisualSourceAndAnimation(params: {
    rarity: Rarity;
    animated: boolean;
    assetUrl: string | null;
    presetId: string | null;
  }): void {
    const { rarity, animated, assetUrl, presetId } = params;
    if (!assetUrl && !presetId) {
      throw new BadRequestException(
        'Either a CSS presetId or an assetUrl is required',
      );
    }
    if (animated && !canCosmeticBeAnimated(rarity)) {
      throw new BadRequestException(
        'Only 4★ (RADIANT) and 5★ (PRISMATIC) cosmetics may be animated',
      );
    }
  }

  /**
   * Ensures the 20 CSS starter items exist in the database if none have been seeded yet.
   */
  async ensureStarterCatalogSeeded(): Promise<void> {
    const count = await this.prisma.cosmeticItem.count();
    if (count > 0) return;
    await this.prisma.cosmeticItem.createMany({
      data: STARTER_COSMETIC_CATALOG.map((item) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        description: item.description,
        slot: item.slot,
        rarity: item.rarity,
        animated: item.animated,
        presetId: item.presetId,
        assetUrl: null,
        active: true,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * GET /cosmetics/me — Owned and equipped cosmetics for the signed-in user.
   */
  async getMyCosmetics(userId: string) {
    const [ownedRows, equippedRows] = await Promise.all([
      this.prisma.userCosmetic.findMany({
        where: { userId, item: { active: true } },
        orderBy: [{ acquiredAt: 'desc' }],
        include: {
          item: true,
        },
      }),
      this.prisma.equippedCosmetic.findMany({
        where: { userId },
        ...ALL_EQUIPPED_COSMETICS_SELECT,
      }),
    ]);

    const equipped = toEquippedSlotsMap(equippedRows);

    const owned = ownedRows.map((row) => ({
      itemId: row.itemId,
      source: row.source,
      acquiredAt: row.acquiredAt.toISOString(),
      item: {
        id: row.item.id,
        slug: row.item.slug,
        name: row.item.name,
        description: row.item.description,
        slot: row.item.slot,
        rarity: row.item.rarity,
        animated: row.item.animated,
        assetUrl: row.item.assetUrl,
        presetId: row.item.presetId,
      },
    }));

    return {
      owned,
      equipped,
    };
  }

  /**
   * PUT /cosmetics/equipped — `{ slot, itemId | null }`.
   * Checks ownership (`403 Forbidden` if not owned per Section 6.6), slot match, and active status.
   */
  async equipSlot(userId: string, slot: CosmeticSlot, itemId: string | null) {
    if (itemId === null) {
      await this.prisma.equippedCosmetic.deleteMany({
        where: { userId, slot },
      });
      return this.getEquippedForUser(userId);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockCosmeticItem(tx, itemId);
      const item = await tx.cosmeticItem.findUnique({
        where: { id: itemId },
      });
      if (!item || !item.active) {
        throw new NotFoundException('Cosmetic item is not available');
      }
      if (item.slot !== slot) {
        throw new BadRequestException(
          `Item "${item.name}" belongs to slot ${item.slot}, not ${slot}`,
        );
      }

      const ownership = await tx.userCosmetic.findUnique({
        where: { userId_itemId: { userId, itemId } },
      });
      if (!ownership) {
        throw new ForbiddenException('You do not own this cosmetic item');
      }

      await tx.equippedCosmetic.upsert({
        where: { userId_slot: { userId, slot } },
        create: { userId, slot, itemId },
        update: { itemId, equippedAt: new Date() },
      });
    });

    return this.getEquippedForUser(userId);
  }

  async getEquippedForUser(userId: string) {
    const rows = await this.prisma.equippedCosmetic.findMany({
      where: { userId },
      ...ALL_EQUIPPED_COSMETICS_SELECT,
    });
    return toEquippedSlotsMap(rows);
  }

  /**
   * GET /admin/cosmetics — List all cosmetic items with owner & equipped counts.
   */
  async listAdminCosmetics(filters?: {
    slot?: CosmeticSlot;
    rarity?: Rarity;
    active?: string;
  }) {
    await this.ensureStarterCatalogSeeded();
    const where: Prisma.CosmeticItemWhereInput = {
      ...(filters?.slot ? { slot: filters.slot } : {}),
      ...(filters?.rarity ? { rarity: filters.rarity } : {}),
      ...(filters?.active === 'true'
        ? { active: true }
        : filters?.active === 'false'
          ? { active: false }
          : {}),
    };
    const items = await this.prisma.cosmeticItem.findMany({
      ...(Object.keys(where).length > 0 ? { where } : {}),
      orderBy: [{ active: 'desc' }, { slot: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: {
          select: {
            owners: true,
            equippedBy: true,
          },
        },
      },
    });

    return items.map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      description: item.description,
      slot: item.slot,
      rarity: item.rarity,
      animated: item.animated,
      assetUrl: item.assetUrl,
      presetId: item.presetId,
      active: item.active,
      createdAt: item.createdAt.toISOString(),
      ownerCount: item._count.owners,
      equippedCount: item._count.equippedBy,
    }));
  }

  /**
   * POST /admin/cosmetics — Create a cosmetic item (CSS presetId or assetUrl).
   */
  async createCosmetic(adminId: string, dto: CreateCosmeticDto) {
    const slug = dto.slug.trim().toLowerCase();
    const name = dto.name.trim();
    const description = (dto.description ?? '').trim();
    const animated = Boolean(dto.animated);
    const assetUrl = dto.assetUrl?.trim() || null;
    const presetId = dto.presetId?.trim() || null;

    this.validateVisualSourceAndAnimation({
      rarity: dto.rarity,
      animated,
      assetUrl,
      presetId,
    });

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.cosmeticItem.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `A cosmetic item with slug "${slug}" already exists`,
        );
      }

      const created = await tx.cosmeticItem.create({
        data: {
          id: `csm_${randomUUID()}`,
          slug,
          name,
          description,
          slot: dto.slot,
          rarity: dto.rarity,
          animated,
          assetUrl,
          presetId,
          active: true,
        },
      });

      await this.auditLogService.recordOrThrow(
        {
          action: 'COSMETIC_CREATED',
          actorId: adminId,
          targetType: 'COSMETIC',
          targetId: created.id,
          metadata: {
            slug: created.slug,
            name: created.name,
            slot: created.slot,
            rarity: created.rarity,
            animated: created.animated,
            presetId: created.presetId,
            assetUrl: created.assetUrl,
          },
        },
        tx,
      );

      return created;
    });
  }

  /**
   * PATCH /admin/cosmetics/:id — Edit a cosmetic item.
   * Per Section 6.6: asset/name/description can change; slot and rarity are locked once anyone owns it.
   */
  async updateCosmetic(
    adminId: string,
    itemId: string,
    dto: UpdateCosmeticDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockCosmeticItem(tx, itemId);
      const current = await tx.cosmeticItem.findUnique({
        where: { id: itemId },
        include: {
          _count: { select: { owners: true } },
        },
      });
      if (!current) {
        throw new NotFoundException('Cosmetic item not found');
      }

      if (dto.active === false && current.active) {
        throw new BadRequestException(
          'Use the deactivate endpoint to take down a cosmetic item and refund owners',
        );
      }

      const ownerCount = current._count.owners;
      const nextSlot = dto.slot ?? current.slot;
      const nextRarity = dto.rarity ?? current.rarity;

      if (
        ownerCount > 0 &&
        (nextSlot !== current.slot || nextRarity !== current.rarity)
      ) {
        throw new BadRequestException(
          'Slot and rarity are locked once a cosmetic item is owned by any user',
        );
      }

      const nextAnimated =
        dto.animated !== undefined ? dto.animated : current.animated;
      const nextAssetUrl =
        dto.assetUrl !== undefined
          ? dto.assetUrl?.trim() || null
          : current.assetUrl;
      const nextPresetId =
        dto.presetId !== undefined
          ? dto.presetId?.trim() || null
          : current.presetId;

      this.validateVisualSourceAndAnimation({
        rarity: nextRarity,
        animated: nextAnimated,
        assetUrl: nextAssetUrl,
        presetId: nextPresetId,
      });

      const data: {
        name?: string;
        description?: string;
        slot?: CosmeticSlot;
        rarity?: Rarity;
        animated?: boolean;
        assetUrl?: string | null;
        presetId?: string | null;
        active?: boolean;
      } = {};
      const changes: Record<
        string,
        {
          from: string | number | boolean | null;
          to: string | number | boolean | null;
        }
      > = {};

      if (dto.name !== undefined && dto.name.trim() !== current.name) {
        data.name = dto.name.trim();
        changes.name = { from: current.name, to: data.name };
      }
      if (
        dto.description !== undefined &&
        dto.description.trim() !== current.description
      ) {
        data.description = dto.description.trim();
        changes.description = {
          from: current.description,
          to: data.description,
        };
      }
      if (nextSlot !== current.slot) {
        data.slot = nextSlot;
        changes.slot = { from: current.slot, to: nextSlot };
      }
      if (nextRarity !== current.rarity) {
        data.rarity = nextRarity;
        changes.rarity = { from: current.rarity, to: nextRarity };
      }
      if (nextAnimated !== current.animated) {
        data.animated = nextAnimated;
        changes.animated = { from: current.animated, to: nextAnimated };
      }
      if (nextAssetUrl !== current.assetUrl) {
        data.assetUrl = nextAssetUrl;
        changes.assetUrl = { from: current.assetUrl, to: nextAssetUrl };
      }
      if (nextPresetId !== current.presetId) {
        data.presetId = nextPresetId;
        changes.presetId = { from: current.presetId, to: nextPresetId };
      }
      if (dto.active !== undefined && dto.active !== current.active) {
        data.active = dto.active;
        changes.active = { from: current.active, to: dto.active };
      }

      if (Object.keys(data).length === 0) {
        return current;
      }

      const updated = await tx.cosmeticItem.update({
        where: { id: itemId },
        data,
      });

      await this.auditLogService.recordOrThrow(
        {
          action: 'COSMETIC_UPDATED',
          actorId: adminId,
          targetType: 'COSMETIC',
          targetId: itemId,
          metadata: {
            slug: updated.slug,
            changes,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * POST /admin/cosmetics/:id/deactivate — Takedown a cosmetic item (Section 6.6):
   * - Sets `active = false`
   * - Unequips from all users
   * - Compensates all owners with its duplicate Shard value (`TAKEDOWN_REFUND`)
   * - Audit-logged
   */
  async deactivateCosmetic(adminId: string, itemId: string, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockCosmeticItem(tx, itemId);
      const item = await tx.cosmeticItem.findUnique({
        where: { id: itemId },
      });
      if (!item) {
        throw new NotFoundException('Cosmetic item not found');
      }
      if (!item.active) {
        throw new ConflictException('Cosmetic item is already deactivated');
      }

      await tx.cosmeticItem.update({
        where: { id: itemId },
        data: { active: false },
      });

      const unequipped = await tx.equippedCosmetic.deleteMany({
        where: { itemId },
      });

      const owners = await tx.userCosmetic.findMany({
        where: { itemId },
        select: { userId: true },
      });

      const refundShardsPerOwner = COSMETIC_REFUND_SHARDS[item.rarity] ?? 30;
      const refundedOwners = await this.economyService.creditTakedownRefunds(
        tx,
        {
          userIds: owners.map((o) => o.userId),
          itemId: item.id,
          amount: refundShardsPerOwner,
          actorId: adminId,
        },
      );

      await this.auditLogService.recordOrThrow(
        {
          action: 'COSMETIC_DEACTIVATED',
          actorId: adminId,
          targetType: 'COSMETIC',
          targetId: item.id,
          metadata: {
            slug: item.slug,
            name: item.name,
            rarity: item.rarity,
            refundedOwners,
            refundShardsPerOwner,
            unequippedCount: unequipped.count,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
          },
        },
        tx,
      );

      return {
        id: item.id,
        active: false,
        refundedOwners,
        refundShardsPerOwner,
        unequippedCount: unequipped.count,
      };
    });
  }

  /**
   * GET /admin/users/:userId/cosmetics — View a user's owned & equipped cosmetics.
   */
  async getAdminUserCosmetics(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.getMyCosmetics(userId);
  }

  /**
   * POST /admin/users/:userId/cosmetics — Admin grants a cosmetic item to a user (`source: 'ADMIN'`).
   */
  async grantCosmeticToUser(params: {
    adminId: string;
    userId: string;
    itemId: string;
    reason?: string;
  }) {
    const { adminId, userId, itemId, reason } = params;
    await this.ensureStarterCatalogSeeded();
    return this.prisma.$transaction(async (tx) => {
      await this.lockCosmeticItem(tx, itemId);
      const [user, item] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
        tx.cosmeticItem.findUnique({ where: { id: itemId } }),
      ]);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      if (!item || !item.active) {
        throw new NotFoundException('Cosmetic item is not available');
      }

      const existing = await tx.userCosmetic.findUnique({
        where: { userId_itemId: { userId, itemId } },
      });
      if (existing) {
        throw new ConflictException('User already owns this cosmetic item');
      }

      const granted = await tx.userCosmetic.create({
        data: {
          userId,
          itemId,
          source: 'ADMIN',
        },
        include: { item: true },
      });

      await this.auditLogService.recordOrThrow(
        {
          action: 'COSMETIC_GRANTED',
          actorId: adminId,
          targetType: 'USER',
          targetId: userId,
          metadata: {
            itemId: item.id,
            slug: item.slug,
            name: item.name,
            ...(reason?.trim() ? { reason: reason.trim() } : {}),
          },
        },
        tx,
      );

      return {
        userId: granted.userId,
        itemId: granted.itemId,
        source: granted.source,
        acquiredAt: granted.acquiredAt.toISOString(),
        item: granted.item,
      };
    });
  }
}
