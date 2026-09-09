import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DiscordLoggerService } from '../discord/discord-logger.service';
import { RateLimitedException } from '../exceptions/rate-limited.exception';

type ErrorResponse = {
  success: false;
  statusCode: number;
  message: string | string[];
  path: string;
  timestamp: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly discordLogger: DiscordLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ url: string; method: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
        ? (exceptionResponse as { message: string | string[] }).message
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';

    if (exception instanceof RateLimitedException) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    const body: ErrorResponse = {
      success: false,
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const errorName = exception instanceof Error ? exception.constructor.name : 'UnknownError';
      const errorMessage = body.message.toString().trim() || 'Internal server error';

      void this.discordLogger.sendError({
        title: `${status} on ${request.method} ${body.path}`,
        errorName,
        fields: [
          { name: 'Status', value: String(status), inline: true },
          { name: 'Method', value: request.method, inline: true },
          { name: 'Error', value: errorName, inline: true },
          { name: 'Path', value: body.path, inline: false },
          { name: 'Message', value: errorMessage, inline: false },
        ],
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }

    response.status(status).json(body);
  }
}
