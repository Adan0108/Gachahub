import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CreateDevTestUserDto } from './dto/create-dev-test-user.dto';
import { DevService } from './dev.service';

/**
 * Local dev tooling only - see app.module.ts, DevModule is only ever
 * registered when env.nodeEnv === 'development'. Every route here is
 * @Public() on purpose: this is meant to be usable before signing in at
 * all (e.g. to spawn your very first test account).
 */
@ApiTags('Dev tools')
@Controller('dev/test-users')
export class DevController {
  constructor(private readonly devService: DevService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List every dev test user' })
  listTestUsers() {
    return this.devService.listTestUsers();
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create a new dev test user' })
  createTestUser(@Body() dto: CreateDevTestUserDto) {
    return this.devService.createTestUser(dto.label);
  }

  @Public()
  @Post(':id/impersonate')
  @ApiOperation({
    summary: "Sign the caller's browser into a dev test user's session",
  })
  async impersonate(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.devService.impersonate(id, res);
    return { message: 'Signed in as test user' };
  }

  @Public()
  @Delete(':id')
  @ApiOperation({ summary: 'Delete one dev test user and everything they own' })
  deleteTestUser(@Param('id') id: string) {
    return this.devService.deleteTestUser(id);
  }

  @Public()
  @Delete()
  @ApiOperation({
    summary: 'Delete every dev test user and everything they own',
  })
  deleteAllTestUsers() {
    return this.devService.deleteAllTestUsers();
  }
}
