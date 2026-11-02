import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

@Injectable()
export class ModerationServiceAuthGuard implements CanActivate {
  private readonly tokenDigest: Buffer;

  constructor() {
    const token = process.env.MODERATION_WORKER_TOKEN;
    if (!token || !/^[\x21-\x7e]{32,512}$/.test(token)) {
      throw new Error(
        'MODERATION_WORKER_TOKEN must contain 32–512 printable ASCII characters',
      );
    }
    this.tokenDigest = createHash('sha256').update(token).digest();
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !/^Bearer [\x21-\x7e]{32,512}$/.test(authorization)
    ) {
      throw new UnauthorizedException();
    }
    const supplied = createHash('sha256')
      .update(authorization.slice(7))
      .digest();
    if (!timingSafeEqual(this.tokenDigest, supplied))
      throw new UnauthorizedException();
    return true;
  }
}
