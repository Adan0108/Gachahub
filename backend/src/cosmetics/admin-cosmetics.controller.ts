import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { AdminGuard } from '../common/guards/admin.guard';
import type { CosmeticSlot, Rarity } from '../generated/prisma/client';
import { CosmeticsService } from './cosmetics.service';
import { CreateCosmeticDto } from './dto/create-cosmetic.dto';
import {
  DeactivateCosmeticDto,
  GrantCosmeticDto,
} from './dto/deactivate-cosmetic.dto';
import { UpdateCosmeticDto } from './dto/update-cosmetic.dto';

@ApiTags('Admin Cosmetics')
@ApiCookieAuth('better-auth.session_token')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminCosmeticsController {
  constructor(private readonly cosmeticsService: CosmeticsService) {}

  @Get('cosmetics')
  @ApiOperation({
    summary: 'List all cosmetic items with owner/equipped counts',
  })
  list(
    @Query('slot') slot?: CosmeticSlot,
    @Query('rarity') rarity?: Rarity,
    @Query('active') active?: string,
  ) {
    return this.cosmeticsService.listAdminCosmetics({ slot, rarity, active });
  }

  @Post('cosmetics')
  @ApiOperation({
    summary: 'Create a cosmetic item (CSS presetId or assetUrl)',
  })
  create(@Session() session: UserSession, @Body() dto: CreateCosmeticDto) {
    return this.cosmeticsService.createCosmetic(session.user.id, dto);
  }

  @Patch('cosmetics/:id')
  @ApiOperation({
    summary: 'Edit a cosmetic item (slot & rarity locked once anyone owns it)',
  })
  update(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: UpdateCosmeticDto,
  ) {
    return this.cosmeticsService.updateCosmetic(session.user.id, id, dto);
  }

  @Post('cosmetics/:id/deactivate')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Deactivate a cosmetic item, unequip from all users, and refund owners in Shards',
  })
  deactivate(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() dto: DeactivateCosmeticDto,
  ) {
    return this.cosmeticsService.deactivateCosmetic(
      session.user.id,
      id,
      dto?.reason,
    );
  }

  @Get('users/:userId/cosmetics')
  @ApiOperation({ summary: "View a user's owned and equipped cosmetics" })
  getUserCosmetics(@Param('userId') userId: string) {
    return this.cosmeticsService.getAdminUserCosmetics(userId);
  }

  @Post('users/:userId/cosmetics')
  @ApiOperation({ summary: 'Grant a cosmetic item to a user (source: ADMIN)' })
  grantCosmetic(
    @Session() session: UserSession,
    @Param('userId') userId: string,
    @Body() dto: GrantCosmeticDto,
  ) {
    return this.cosmeticsService.grantCosmeticToUser({
      adminId: session.user.id,
      userId,
      itemId: dto.itemId,
      reason: dto.reason,
    });
  }
}
