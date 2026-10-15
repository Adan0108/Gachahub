import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { DevService } from './dev.service';

/** Local dev tooling only, like DevController: DevModule is registered only when running in development. */
@ApiTags('Dev tools')
@Controller('dev/emotes')
export class DevEmotesController {
  constructor(private readonly devService: DevService) {}

  @Public()
  @Post('seed')
  @ApiOperation({ summary: 'Add a few global chat emotes to react with' })
  seed() {
    return this.devService.seedGlobalEmotes();
  }
}
