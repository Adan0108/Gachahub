import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CosmeticsService } from './cosmetics.service';

describe('CosmeticsService', () => {
  const prisma = {
    cosmeticItem: {
      count: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userCosmetic: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    equippedCosmetic: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const economyService = {
    creditTakedownRefunds: jest.fn(),
  };

  const auditLogService = {
    recordOrThrow: jest.fn(),
  };

  let service: CosmeticsService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => Promise.resolve(cb(prisma)),
    );
    service = new CosmeticsService(
      prisma as never,
      economyService as never,
      auditLogService as never,
    );
  });

  describe('getMyCosmetics', () => {
    it('returns owned active items and equipped slots map', async () => {
      const acquiredAt = new Date('2026-10-30T00:00:00Z');
      prisma.userCosmetic.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          itemId: 'csm_frame_starlight_ring',
          source: 'ADMIN',
          acquiredAt,
          item: {
            id: 'csm_frame_starlight_ring',
            slug: 'frame-starlight-ring',
            name: 'Starlight Ring',
            description: 'A crisp sapphire ring.',
            slot: 'FRAME',
            rarity: 'GLIMMER',
            animated: false,
            assetUrl: null,
            presetId: 'frame-starlight-ring',
            active: true,
          },
        },
      ]);
      prisma.equippedCosmetic.findMany.mockResolvedValue([
        {
          slot: 'FRAME',
          item: {
            id: 'csm_frame_starlight_ring',
            slug: 'frame-starlight-ring',
            name: 'Starlight Ring',
            slot: 'FRAME',
            rarity: 'GLIMMER',
            animated: false,
            assetUrl: null,
            presetId: 'frame-starlight-ring',
            active: true,
          },
        },
      ]);

      const result = await service.getMyCosmetics('user-1');

      expect(result.owned).toHaveLength(1);
      expect(result.owned[0]).toMatchObject({
        itemId: 'csm_frame_starlight_ring',
        source: 'ADMIN',
        acquiredAt: acquiredAt.toISOString(),
      });
      expect(result.equipped.frame?.id).toBe('csm_frame_starlight_ring');
      expect(result.equipped.banner).toBeNull();
    });
  });

  describe('equipSlot', () => {
    it('throws 403 ForbiddenException when user does not own the item (Section 6.6)', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_frame_starlight_ring',
        name: 'Starlight Ring',
        slot: 'FRAME',
        active: true,
      });
      prisma.userCosmetic.findUnique.mockResolvedValue(null);

      await expect(
        service.equipSlot('user-1', 'FRAME', 'csm_frame_starlight_ring'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.equippedCosmetic.upsert).not.toHaveBeenCalled();
    });

    it('throws 400 BadRequestException when item slot does not match target slot', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_bnr_horizon_stride',
        name: 'Horizon Stride',
        slot: 'BANNER',
        active: true,
      });

      await expect(
        service.equipSlot('user-1', 'FRAME', 'csm_bnr_horizon_stride'),
      ).rejects.toThrow(BadRequestException);
    });

    it('equips an owned active item and returns updated equipped slots', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_frame_starlight_ring',
        name: 'Starlight Ring',
        slot: 'FRAME',
        active: true,
      });
      prisma.userCosmetic.findUnique.mockResolvedValue({
        userId: 'user-1',
        itemId: 'csm_frame_starlight_ring',
      });
      prisma.equippedCosmetic.findMany.mockResolvedValue([
        {
          slot: 'FRAME',
          item: {
            id: 'csm_frame_starlight_ring',
            slug: 'frame-starlight-ring',
            name: 'Starlight Ring',
            slot: 'FRAME',
            rarity: 'GLIMMER',
            animated: false,
            assetUrl: null,
            presetId: 'frame-starlight-ring',
            active: true,
          },
        },
      ]);

      const equipped = await service.equipSlot(
        'user-1',
        'FRAME',
        'csm_frame_starlight_ring',
      );

      // The item row is locked before the checks, so a takedown can't slip in between.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.equippedCosmetic.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_slot: { userId: 'user-1', slot: 'FRAME' } },
          create: {
            userId: 'user-1',
            slot: 'FRAME',
            itemId: 'csm_frame_starlight_ring',
          },
        }),
      );
      expect(equipped.frame?.id).toBe('csm_frame_starlight_ring');
    });

    it('unequips a slot when itemId is null', async () => {
      prisma.equippedCosmetic.findMany.mockResolvedValue([]);

      const equipped = await service.equipSlot('user-1', 'FRAME', null);

      expect(prisma.equippedCosmetic.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', slot: 'FRAME' },
      });
      expect(equipped.frame).toBeNull();
    });
  });

  describe('createCosmetic', () => {
    it('rejects animated = true for GLIMMER (3★) cosmetics (Section 6.2)', async () => {
      await expect(
        service.createCosmetic('admin-1', {
          slug: 'glimmer-anim',
          name: 'Glimmer Anim',
          description: 'Test',
          slot: 'FRAME',
          rarity: 'GLIMMER',
          animated: true,
          presetId: 'frame-starlight-ring',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a cosmetic and records COSMETIC_CREATED audit log', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue(null);
      prisma.cosmeticItem.create.mockResolvedValue({
        id: 'csm_1',
        slug: 'astral-frame',
        name: 'Astral Frame',
        description: 'Desc',
        slot: 'FRAME',
        rarity: 'RADIANT',
        animated: true,
        presetId: 'frame-astral-orbit',
        assetUrl: null,
        active: true,
      });

      const created = await service.createCosmetic('admin-1', {
        slug: 'astral-frame',
        name: 'Astral Frame',
        description: 'Desc',
        slot: 'FRAME',
        rarity: 'RADIANT',
        animated: true,
        presetId: 'frame-astral-orbit',
      });

      expect(created.id).toBe('csm_1');
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COSMETIC_CREATED',
          actorId: 'admin-1',
          targetType: 'COSMETIC',
          targetId: 'csm_1',
        }),
        prisma,
      );
    });
  });

  describe('updateCosmetic', () => {
    it('locks slot and rarity once anyone owns the item (Section 6.6)', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_1',
        slug: 'starlight-ring',
        name: 'Starlight Ring',
        description: 'Desc',
        slot: 'FRAME',
        rarity: 'GLIMMER',
        animated: false,
        presetId: 'frame-starlight-ring',
        assetUrl: null,
        _count: { owners: 2 },
      });

      await expect(
        service.updateCosmetic('admin-1', 'csm_1', {
          rarity: 'PRISMATIC',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows changing name and description even when owned', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_1',
        slug: 'starlight-ring',
        name: 'Starlight Ring',
        description: 'Old',
        slot: 'FRAME',
        rarity: 'GLIMMER',
        animated: false,
        presetId: 'frame-starlight-ring',
        assetUrl: null,
        _count: { owners: 2 },
      });
      prisma.cosmeticItem.update.mockResolvedValue({
        id: 'csm_1',
        slug: 'starlight-ring',
        name: 'Starlight Ring II',
        description: 'New',
        slot: 'FRAME',
        rarity: 'GLIMMER',
        animated: false,
        presetId: 'frame-starlight-ring',
        assetUrl: null,
      });

      const updated = await service.updateCosmetic('admin-1', 'csm_1', {
        name: 'Starlight Ring II',
        description: 'New',
      });

      expect(updated.name).toBe('Starlight Ring II');
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COSMETIC_UPDATED',
          targetId: 'csm_1',
        }),
        prisma,
      );
    });
  });

  describe('deactivateCosmetic', () => {
    it('deactivates item, unequips from all users, refunds owners in Shards, and writes audit log (Section 6.6)', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_rad_1',
        slug: 'astral-orbit',
        name: 'Astral Orbit',
        slot: 'FRAME',
        rarity: 'RADIANT',
        active: true,
      });
      prisma.equippedCosmetic.deleteMany.mockResolvedValue({ count: 2 });
      prisma.userCosmetic.findMany.mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ]);
      economyService.creditTakedownRefunds.mockResolvedValue(2);

      const res = await service.deactivateCosmetic(
        'admin-1',
        'csm_rad_1',
        'Copyright takedown',
      );

      expect(prisma.cosmeticItem.update).toHaveBeenCalledWith({
        where: { id: 'csm_rad_1' },
        data: { active: false },
      });
      expect(prisma.equippedCosmetic.deleteMany).toHaveBeenCalledWith({
        where: { itemId: 'csm_rad_1' },
      });
      expect(economyService.creditTakedownRefunds).toHaveBeenCalledWith(
        prisma,
        {
          userIds: ['user-1', 'user-2'],
          itemId: 'csm_rad_1',
          amount: 80, // RADIANT duplicate value = 80 Shards
          actorId: 'admin-1',
        },
      );
      expect(res).toEqual({
        id: 'csm_rad_1',
        active: false,
        refundedOwners: 2,
        refundShardsPerOwner: 80,
        unequippedCount: 2,
      });
    });

    it('throws ConflictException when item is already deactivated', async () => {
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_rad_1',
        active: false,
      });

      await expect(
        service.deactivateCosmetic('admin-1', 'csm_rad_1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('grantCosmeticToUser', () => {
    it('grants active item with ADMIN source and writes COSMETIC_GRANTED audit log', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.cosmeticItem.findUnique.mockResolvedValue({
        id: 'csm_1',
        slug: 'frame-starlight-ring',
        name: 'Starlight Ring',
        active: true,
      });
      prisma.userCosmetic.findUnique.mockResolvedValue(null);
      const acquiredAt = new Date('2026-10-30T05:00:00Z');
      prisma.userCosmetic.create.mockResolvedValue({
        userId: 'user-1',
        itemId: 'csm_1',
        source: 'ADMIN',
        acquiredAt,
        item: {
          id: 'csm_1',
          slug: 'frame-starlight-ring',
          name: 'Starlight Ring',
        },
      });

      const granted = await service.grantCosmeticToUser({
        adminId: 'admin-1',
        userId: 'user-1',
        itemId: 'csm_1',
        reason: 'Contest winner',
      });

      expect(granted.source).toBe('ADMIN');
      expect(auditLogService.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COSMETIC_GRANTED',
          actorId: 'admin-1',
          targetType: 'USER',
          targetId: 'user-1',
        }),
        prisma,
      );
    });

    it('throws NotFoundException when target user or cosmetic does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.cosmeticItem.findUnique.mockResolvedValue(null);

      await expect(
        service.grantCosmeticToUser({
          adminId: 'admin-1',
          userId: 'missing',
          itemId: 'csm_1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
