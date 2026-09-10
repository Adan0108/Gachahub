import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when a rate limit is hit. Carries how long the caller should wait
 * so HttpExceptionFilter can set a proper Retry-After header on the response.
 */
export class RateLimitedException extends HttpException {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
