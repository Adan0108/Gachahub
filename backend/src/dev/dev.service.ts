import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { auth } from '../auth/auth';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every account this module creates is tagged with this name prefix, and
 * every destructive operation here (single or bulk delete) re-checks the
 * prefix server-side before touching a row - so even a wrong/guessed id can
 * never reach a real user's account, regardless of what the caller passes.
 */
const TEST_USER_PREFIX = 'DevTest_';

/**
 * Fixed, shared password for every dev test account. Fine to be a constant:
 * these are disposable accounts behind a route that only exists at all when
 * DevModule is registered (app.module.ts, gated on env.nodeEnv), and nothing
 * about knowing this string is useful outside that same dev environment.
 */
const TEST_USER_PASSWORD = 'DevTest123!';

@Injectable()
export class DevService {
  constructor(private readonly prisma: PrismaService) {
    // Defense in depth - DevModule should never even be registered outside
    // development (see app.module.ts), but a service that can mint a
    // session for any user id and mass-delete accounts is exactly the kind
    // of thing that deserves a second, independent check.
    if (env.nodeEnv === 'production') {
      throw new InternalServerErrorException(
        'DevService must never be instantiated in production',
      );
    }
  }

  async listTestUsers() {
    return this.prisma.user.findMany({
      where: { name: { startsWith: TEST_USER_PREFIX } },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTestUser(label?: string) {
    // Random enough to never collide within one dev session's worth of
    // spawned accounts - collision resistance beyond that doesn't matter
    // here, unlike a real identifier.
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const cleanLabel = label?.trim().replace(/\s+/g, '');
    const name = cleanLabel
      ? `${TEST_USER_PREFIX}${cleanLabel}_${suffix}`
      : `${TEST_USER_PREFIX}${suffix}`;
    const email = `devtest.${suffix}@example.com`;

    // Calling this endpoint's handler directly (no `headers`/`request`) is
    // better-auth's own supported pattern for trusted server-side account
    // creation - it never logs the caller's own browser session in as the
    // new account, since no cookies are involved unless asResponse is set.
    const result = await auth.api.signUpEmail({
      body: { email, password: TEST_USER_PASSWORD, name },
    });

    return {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    };
  }

  /** Signs the caller's browser into `id`'s session - `id` must be a dev test user, checked here independently of anything the caller claims. */
  async impersonate(id: string, res: Response): Promise<void> {
    const user = await this.assertTestUser(id);

    const response = await auth.api.signInEmail({
      body: { email: user.email, password: TEST_USER_PASSWORD },
      asResponse: true,
    });

    const setCookie = response.headers.getSetCookie();
    if (setCookie.length > 0) {
      res.setHeader('Set-Cookie', setCookie);
    }
  }

  async deleteTestUser(id: string): Promise<{ message: string }> {
    await this.assertTestUser(id);
    // Prisma's schema-level onDelete: Cascade on every direct User relation
    // (ChatDevice, ChatParticipant, ChatMessage.sender, Follow, etc.) does
    // the actual cleanup - a real DB-level ON DELETE CASCADE, not something
    // this method has to enumerate by hand.
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Test user deleted' };
  }

  async deleteAllTestUsers(): Promise<{ deleted: number }> {
    const result = await this.prisma.user.deleteMany({
      where: { name: { startsWith: TEST_USER_PREFIX } },
    });
    return { deleted: result.count };
  }

  private async assertTestUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.name.startsWith(TEST_USER_PREFIX)) {
      throw new NotFoundException('Not a dev test user');
    }
    return user;
  }
}
