import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PostsModule } from '../posts/posts.module';
import { BlocksModule } from '../blocks/blocks.module';

@Module({
  imports: [PostsModule, BlocksModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
