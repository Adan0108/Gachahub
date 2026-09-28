jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatBackupController } from './chat-backup.controller';
import { ListBlobsQueryDto } from './dto/list-blobs-query.dto';
import { DeleteBackupDto } from './dto/delete-backup.dto';
import { PutBackupKeyDto } from './dto/put-backup-key.dto';
import { UploadBlobsDto } from './dto/upload-blobs.dto';

const session = { user: { id: 'u1' } } as never;

describe('ChatBackupController', () => {
  const service = {
    getStatus: jest.fn(),
    putKey: jest.fn(),
    issueChallenge: jest.fn(),
    disable: jest.fn(),
    cancelDeletion: jest.fn(),
    uploadBlobs: jest.fn(),
    listBlobs: jest.fn(),
  };
  const controller = new ChatBackupController(service as never);

  it('always acts on the session user', async () => {
    await controller.status(session);
    const put = { keyCheck: 'abc=', replaceSecret: 'def=' };
    await controller.putKey(session, put);
    await controller.challenge(session);
    const del = { confirm: true as const, nonce: 'n', proof: 'p' };
    await controller.disable(session, del);
    const cancel = { nonce: 'n', proof: 'p' };
    await controller.cancelDeletion(session, cancel);
    await controller.uploadBlobs(session, { items: [] });
    await controller.listBlobs(session, { after: 'c', limit: 5 });

    expect(service.getStatus).toHaveBeenCalledWith('u1');
    expect(service.putKey).toHaveBeenCalledWith('u1', put);
    expect(service.issueChallenge).toHaveBeenCalledWith('u1');
    expect(service.disable).toHaveBeenCalledWith('u1', del);
    expect(service.cancelDeletion).toHaveBeenCalledWith('u1', cancel);
    expect(service.uploadBlobs).toHaveBeenCalledWith('u1', []);
    expect(service.listBlobs).toHaveBeenCalledWith('u1', 'c', 5);
  });
});

describe('chat backup DTOs', () => {
  const item = { conversationId: 'c', messageId: 'm', ciphertext: 'AAAA' };
  const errorsFor = (dto: object, cls: new () => object) =>
    validate(plainToInstance(cls, dto));

  it('accepts a valid batch', async () => {
    expect(await errorsFor({ items: [item] }, UploadBlobsDto)).toHaveLength(0);
  });

  it('rejects an empty batch and one over 100 items', async () => {
    expect(await errorsFor({ items: [] }, UploadBlobsDto)).not.toHaveLength(0);
    expect(
      await errorsFor({ items: Array(101).fill(item) }, UploadBlobsDto),
    ).not.toHaveLength(0);
  });

  it('rejects non-base64 or oversized ciphertext', async () => {
    const bad = { ...item, ciphertext: '***' };
    const big = { ...item, ciphertext: 'A'.repeat(90_000) };

    expect(await errorsFor({ items: [bad] }, UploadBlobsDto)).not.toHaveLength(
      0,
    );
    expect(await errorsFor({ items: [big] }, UploadBlobsDto)).not.toHaveLength(
      0,
    );
  });

  it('caps the page size at 200', async () => {
    expect(await errorsFor({ limit: '200' }, ListBlobsQueryDto)).toHaveLength(
      0,
    );
    expect(
      await errorsFor({ limit: '201' }, ListBlobsQueryDto),
    ).not.toHaveLength(0);
  });

  it('requires base64 for the key check and secret', async () => {
    const ok = { keyCheck: 'AAAA', replaceSecret: 'AAAA' };

    expect(await errorsFor(ok, PutBackupKeyDto)).toHaveLength(0);
    expect(
      await errorsFor({ ...ok, keyCheck: '%%' }, PutBackupKeyDto),
    ).not.toHaveLength(0);
    expect(
      await errorsFor({ keyCheck: 'AAAA' }, PutBackupKeyDto),
    ).not.toHaveLength(0);
  });

  it('only accepts a boolean replace flag', async () => {
    const ok = { keyCheck: 'AAAA', replaceSecret: 'AAAA' };

    expect(
      await errorsFor({ ...ok, replace: true }, PutBackupKeyDto),
    ).toHaveLength(0);
    expect(
      await errorsFor({ ...ok, replace: 'yes' }, PutBackupKeyDto),
    ).not.toHaveLength(0);
  });

  it('turning off requires confirm: true', async () => {
    expect(await errorsFor({ confirm: true }, DeleteBackupDto)).toHaveLength(0);
    expect(await errorsFor({}, DeleteBackupDto)).not.toHaveLength(0);
    expect(
      await errorsFor({ confirm: false }, DeleteBackupDto),
    ).not.toHaveLength(0);
  });
});
