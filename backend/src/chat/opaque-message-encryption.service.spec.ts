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
});
