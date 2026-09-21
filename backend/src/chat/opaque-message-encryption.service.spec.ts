import { BadRequestException } from '@nestjs/common';
import { EncryptedMessagePayloadDto } from './dto/encrypted-message-payload.dto';
import { buildTestApplicationMessage } from '../mls-handshakes/test-support/build-test-commit';
import { OpaqueMessageEncryptionService } from './opaque-message-encryption.service';

function payload(
  fields: Partial<EncryptedMessagePayloadDto>,
): EncryptedMessagePayloadDto {
  return Object.assign(new EncryptedMessagePayloadDto(), fields);
}

describe('OpaqueMessageEncryptionService', () => {
  const service = new OpaqueMessageEncryptionService();

  it('passes through a real application message unchanged', async () => {
    const message = await buildTestApplicationMessage('conv-1');
    const ciphertext = Buffer.from(message).toString('base64');

    const result = await service.preparePayload(
      payload({ ciphertext, contentType: 'TEXT' }),
    );

    expect(result).toEqual({ ciphertext, encryptionMeta: undefined });
  });

  it('rejects non-MLS ciphertext for a real content type', async () => {
    await expect(
      service.preparePayload(
        payload({
          ciphertext: Buffer.from('not mls bytes').toString('base64'),
          contentType: 'TEXT',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects ciphertext with no contentType declared (defaults to a real message)', async () => {
    await expect(
      service.preparePayload(
        payload({
          ciphertext: Buffer.from('not mls bytes').toString('base64'),
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not validate the placeholder ciphertext for a SYSTEM message', async () => {
    const result = await service.preparePayload(
      payload({
        ciphertext: 'placeholder-pending-mls-setup',
        contentType: 'SYSTEM',
      }),
    );

    expect(result.ciphertext).toBe('placeholder-pending-mls-setup');
  });

  // regression: contentType is client-supplied and otherwise unrestricted -
  // exempting all of SYSTEM from framing validation would let any client
  // send contentType: 'SYSTEM' with arbitrary non-MLS bytes as a real
  // message, exactly what this validation exists to block.
  it('still validates ciphertext for a SYSTEM message that is not the exact placeholder', async () => {
    await expect(
      service.preparePayload(
        payload({
          ciphertext: Buffer.from('arbitrary garbage').toString('base64'),
          contentType: 'SYSTEM',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // regression: assertIsApplicationMessage used to skip the group_id
  // cross-check unconditionally - fine for a brand-new conversation (no id
  // yet), wrong for an existing one, where a participant could otherwise
  // relay another conversation's ciphertext into this one.
  it('rejects ciphertext framed for a different conversation when conversationId is known', async () => {
    const message = await buildTestApplicationMessage('conv-1');
    const ciphertext = Buffer.from(message).toString('base64');

    await expect(
      service.preparePayload(
        payload({ ciphertext, contentType: 'TEXT' }),
        'conv-2',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts ciphertext framed for the conversation it is actually sent to', async () => {
    const message = await buildTestApplicationMessage('conv-1');
    const ciphertext = Buffer.from(message).toString('base64');

    const result = await service.preparePayload(
      payload({ ciphertext, contentType: 'TEXT' }),
      'conv-1',
    );

    expect(result.ciphertext).toBe(ciphertext);
  });
});
