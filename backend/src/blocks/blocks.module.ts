import { Module } from '@nestjs/common';
import { BlocksRepository } from './blocks.repository';
import { BlocksService } from './blocks.service';

@Module({
  providers: [BlocksRepository, BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
