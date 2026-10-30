import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';

export function trustedApplicationOrigins(): string[] {
  return [
    ...new Set(
      [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        process.env.BETTER_AUTH_URL || 'http://localhost:3000',
      ]
        .flatMap((value) => value.split(','))
        .map((value) => {
          const url = new URL(value.trim());
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw new Error('Invalid application origin');
          return url.origin;
        }),
    ),
  ];
}

/** Cookie-authenticated writes require evidence of a trusted browser origin. */
@Injectable()
export class RequestOriginInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<{
      user?: { id: string };
      method: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    if (
      request.user?.id &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ) {
      const origin = request.headers.origin;
      const referer = request.headers.referer;
      const candidate = origin ?? referer;
      let trusted = false;
      try {
        if (typeof candidate === 'string') {
          const url = new URL(candidate);
          trusted =
            trustedApplicationOrigins().includes(url.origin) &&
            (!origin ||
              (url.pathname === '/' &&
                !url.search &&
                !url.hash &&
                !url.username &&
                !url.password));
        }
      } catch {
        /* Invalid/opaque origins are untrusted. */
      }
      if (
        (candidate !== undefined ||
          request.headers.cookie ||
          request.headers['sec-fetch-site']) &&
        !trusted
      )
        throw new ForbiddenException('Request origin is not trusted');
    }
    return next.handle();
  }
}
