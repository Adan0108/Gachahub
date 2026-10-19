import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ChatGroupPhotoRepository } from '../src/chat/chat-group-photo.repository';
import { PrismaService } from '../src/prisma/prisma.service';

// Real PostgreSQL. Run it against a throwaway database (DATABASE_URL), never the shared one.
describe('Group photo uploads (real database)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let db: PrismaService;
  let repository: ChatGroupPhotoRepository;
  const token = randomUUID();
  const owner = `gp-owner-${token}`;
  let conversationId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService, ChatGroupPhotoRepository],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    repository = app.get(ChatGroupPhotoRepository);
    await db.user.create({
      data: { id: owner, name: 'Owner', email: `${owner}@example.invalid` },
    });
    conversationId = (
      await db.chatConversation.create({ data: { type: 'GROUP', title: 'G' } })
    ).id;
  });

  afterAll(async () => {
    if (db) {
      await db.chatConversation.deleteMany({ where: { id: conversationId } });
      await db.mediaUpload.deleteMany({ where: { userId: owner } });
      await db.user.deleteMany({ where: { id: owner } });
    }
    await app?.close();
  });

  const upload = (name: string) =>
    db.mediaUpload.create({
      data: {
        userId: owner,
        purpose: 'GROUP_PHOTO',
        resourceType: 'IMAGE',
        status: 'UPLOADED',
        publicId: `gp/${name}-${token}`,
        secureUrl: `https://res.cloudinary.com/x/${name}.png`,
      },
    });

  it('points the group at the upload and claims it', async () => {
    const first = await upload('first');

    const result = await repository.replace(conversationId, owner, {
      id: first.id,
      secureUrl: first.secureUrl!,
    });

    expect(result.previousUploadId).toBeNull();
    expect(result.conversation).toMatchObject({
      photoUrl: first.secureUrl,
      photoMediaUploadId: first.id,
    });
    expect(
      (await db.mediaUpload.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
    ).toBe('ATTACHED');
  });

  it('hands back the photo it replaced, so it can be released', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });
    const second = await upload('second');

    const result = await repository.replace(conversationId, owner, {
      id: second.id,
      secureUrl: second.secureUrl!,
    });

    expect(result.previousUploadId).toBe(before.photoMediaUploadId);
    expect(result.conversation.photoMediaUploadId).toBe(second.id);
  });

  it('refuses an upload that is not an unclaimed GROUP_PHOTO of this user', async () => {
    const stranger = await db.mediaUpload.create({
      data: {
        userId: owner,
        purpose: 'AVATAR',
        resourceType: 'IMAGE',
        status: 'UPLOADED',
        publicId: `gp/avatar-${token}`,
        secureUrl: 'https://res.cloudinary.com/x/avatar.png',
      },
    });

    await expect(
      repository.replace(conversationId, owner, {
        id: stranger.id,
        secureUrl: stranger.secureUrl!,
      }),
    ).rejects.toThrow();
  });

  it('clears the photo and returns what to release', async () => {
    const before = await db.chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
    });

    const result = await repository.clear(conversationId);

    expect(result.previousUploadId).toBe(before.photoMediaUploadId);
    expect(result.conversation).toMatchObject({
      photoUrl: null,
      photoMediaUploadId: null,
    });
  });
});
