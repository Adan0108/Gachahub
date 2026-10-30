import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ForbiddenException,
} from '@nestjs/common';
import { SanctionAccessService } from './sanction-access.service';
import { WsException } from '@nestjs/websockets';

/** Runs after authentication guards. No cached state: existing sessions obey live expiry. */
@Injectable()
export class SanctionInterceptor implements NestInterceptor {
  constructor(private readonly access: SanctionAccessService) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<{
        user?: { id: string };
        method: string;
        path: string;
        params: Record<string, string>;
        body?: Record<string, unknown>;
        query?: Record<string, unknown>;
        headers: { origin?: string };
      }>();
      if (request.user?.id) {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
          request.headers.origin &&
          ![
            process.env.FRONTEND_URL || 'http://localhost:5173',
            process.env.BETTER_AUTH_URL || 'http://localhost:3000',
          ].includes(request.headers.origin)
        )
          throw new ForbiddenException('Request origin is not trusted');
        const path = request.path;
        // Notices and appeals remain available during a temporary suspension.
        const recovery =
          (path === '/users/me' && request.method === 'GET') ||
          /^\/me\/moderation(?:\/|$)/.test(path) ||
          path.startsWith('/notifications');
        if (!recovery)
          await this.access.assertAllowed(
            request.user.id,
            !['GET', 'HEAD', 'OPTIONS'].includes(request.method),
            await this.access.routeGame(
              path,
              request.params,
              request.body,
              request.query,
            ),
          );
      }
    } else if (context.getType() === 'ws') {
      const socket = context
        .switchToWs()
        .getClient<{ data: { userId?: string; authReady?: Promise<void> } }>();
      await socket.data.authReady;
      if (socket.data.userId) {
        const ws = context.switchToWs();
        const pattern: string = ws.getPattern();
        const payload = ws.getData<{ slug?: unknown }>();
        const gameId =
          pattern === 'community:join' && typeof payload?.slug === 'string'
            ? await this.access.routeGame('/games/:gameSlug', {
                gameSlug: payload.slug,
              })
            : undefined;
        try {
          await this.access.assertAllowed(
            socket.data.userId,
            !['community:join', 'community:leave'].includes(pattern),
            gameId,
          );
        } catch (error) {
          if (error instanceof ForbiddenException)
            throw new WsException({
              code: 'ACCOUNT_RESTRICTED',
              message: 'View your moderation notices and appeals.',
            });
          throw error;
        }
      }
    }
    return next.handle();
  }
}
