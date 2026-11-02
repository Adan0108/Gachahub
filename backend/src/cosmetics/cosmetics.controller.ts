import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CosmeticsService } from './cosmetics.service';
import { EquipCosmeticDto } from './dto/equip-cosmetic.dto';

@ApiTags('Cosmetics')
@ApiCookieAuth('better-auth.session_token')
@Controller('cosmetics')
export class CosmeticsController {
  constructor(private readonly cosmeticsService: CosmeticsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Owned and equipped cosmetics for the signed-in user',
  })
  getMe(@Session() session: UserSession) {
    return this.cosmeticsService.getMyCosmetics(session.user.id);
  }

  @Put('equipped')
  @ApiOperation({
    summary: 'Equip an owned cosmetic item to a slot, or pass null to unequip',
  })
  equip(@Session() session: UserSession, @Body() dto: EquipCosmeticDto) {
    return this.cosmeticsService.equipSlot(
      session.user.id,
      dto.slot,
      dto.itemId,
    );
  }
}
