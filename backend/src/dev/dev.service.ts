import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { auth } from '../auth/auth';
import { SessionTerminator } from '../auth/session-terminator.service';
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

/** Small flat pictures, drawn here so there is nothing to host: a circle with a white shape on it. */
const SAMPLE_EMOTES: Array<{
  shortcode: string;
  background: string;
  shape: string;
}> = [
  {
    shortcode: 'pity',
    background: '#8b6cff',
    shape:
      '<path d="M32 46 L18 32 a8 8 0 0 1 14 -9 a8 8 0 0 1 14 9 Z" fill="#fff"/>',
  },
  {
    shortcode: 'lucky',
    background: '#2fbf71',
    shape:
      '<polygon points="32,14 37,26 50,27 40,36 43,49 32,42 21,49 24,36 14,27 27,26" fill="#fff"/>',
  },
  {
    shortcode: 'salty',
    background: '#ff7ac8',
    shape: '<rect x="20" y="20" width="24" height="24" rx="4" fill="#fff"/>',
  },
  {
    shortcode: 'roll',
    background: '#3a9aff',
    shape:
      '<circle cx="32" cy="32" r="12" fill="none" stroke="#fff" stroke-width="5"/>',
  },
];

function sampleEmoteImage(background: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="30" fill="${background}"/>${shape}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

@Injectable()
export class DevService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionTerminator: SessionTerminator,
  ) {
    // Defense in depth - DevModule should never even be registered outside
    // development (see app.module.ts), but a service that can mint a
    // session for any user id and mass-delete accounts is exactly the kind
    // of thing that deserves a second, independent check. Allow-lists
    // 'development' rather than blocking 'production' specifically - any
    // other value (an unset NODE_ENV, 'staging', a typo) must fail closed
    // too, not just the one literal string.
    if (env.nodeEnv !== 'development') {
      throw new InternalServerErrorException(
        'DevService must never be instantiated outside development',
      );
    }
  }

  /** Adds a few global emotes for trying reactions without an upload; safe to run again. */
  async seedGlobalEmotes() {
    const created: string[] = [];
    const existing: string[] = [];

    for (const sample of SAMPLE_EMOTES) {
      const found = await this.prisma.chatEmote.findFirst({
        where: {
          scope: 'GLOBAL',
          shortcode: sample.shortcode,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (found) {
        existing.push(sample.shortcode);
        continue;
      }

      const imageUrl = sampleEmoteImage(sample.background, sample.shape);

      await this.prisma.chatEmote.create({
        data: {
          scope: 'GLOBAL',
          shortcode: sample.shortcode,
          imageUrl,
          width: 64,
          height: 64,
          mimeType: 'image/svg+xml',
          fileSize: imageUrl.length,
        },
      });
      created.push(sample.shortcode);
    }

    return { created, existing };
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
    await this.forgetLogins({ id });
    await this.detachMediaUploads({ id });
    // Prisma's schema-level onDelete: Cascade on every direct User relation
    // (ChatDevice, ChatParticipant, ChatMessage.sender, Follow, etc.) does
    // the actual cleanup - a real DB-level ON DELETE CASCADE, not something
    // this method has to enumerate by hand.
    await this.prisma.user.delete({ where: { id } });
    return { message: 'Test user deleted' };
  }

  async deleteAllTestUsers(): Promise<{ deleted: number }> {
    const where = { name: { startsWith: TEST_USER_PREFIX } };
    await this.forgetLogins(where);
    await this.detachMediaUploads(where);
    const result = await this.prisma.user.deleteMany({ where });
    return { deleted: result.count };
  }

  /** ChatMessageMedia/PostMedia -> MediaUpload is RESTRICT, so a user's own upload can outlive the message/post that's about to cascade away with them; drop those links first. */
  private async detachMediaUploads(
    userWhere: { id: string } | { name: { startsWith: string } },
  ) {
    const users = await this.prisma.user.findMany({
      where: userWhere,
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length === 0) return;

    await this.prisma.chatMessageMedia.deleteMany({
      where: { mediaUpload: { userId: { in: userIds } } },
    });
    await this.prisma.postMedia.deleteMany({
      where: { mediaUpload: { userId: { in: userIds } } },
    });
  }

  /** Deleting a user cascades their logins away in the database only, so end them properly first. */
  private async forgetLogins(
    userWhere: { id: string } | { name: { startsWith: string } },
  ) {
    const sessions = await this.prisma.session.findMany({
      where: { user: userWhere },
      select: { id: true, token: true },
    });

    await this.sessionTerminator.end(sessions);
  }

  private async assertTestUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.name.startsWith(TEST_USER_PREFIX)) {
      throw new NotFoundException('Not a dev test user');
    }
    return user;
  }
}
