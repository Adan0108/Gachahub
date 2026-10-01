import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UserSearchRateLimiterService } from './user-search-rate-limiter.service';
import { PostsModule } from '../posts/posts.module';
import { BlocksModule } from '../blocks/blocks.module';

@Module({
  imports: [PostsModule, BlocksModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, UserSearchRateLimiterService],
})
export class UsersModule {}
