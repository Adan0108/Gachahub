import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { EncryptedMessagePayloadDto } from './encrypted-message-payload.dto';

describe('EncryptedMessagePayloadDto', () => {
  it('allows encryptionMeta to be omitted entirely', async () => {
    const dto = plainToInstance(EncryptedMessagePayloadDto, {
      ciphertext: 'x'.repeat(10),
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('allows a small encryptionMeta object', async () => {
    const dto = plainToInstance(EncryptedMessagePayloadDto, {
      ciphertext: 'x'.repeat(10),
      encryptionMeta: { version: 'e2ee-v1', nonce: 'abc' },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  // regression: encryptionMeta had no size bound of its own - only
  // ciphertext did (MaxLength(20000)) - so it was bounded only by
  // whatever the request body parser's overall limit happened to be.
  it('rejects an encryptionMeta object that serializes past the size cap', async () => {
    const dto = plainToInstance(EncryptedMessagePayloadDto, {
      ciphertext: 'x'.repeat(10),
      encryptionMeta: { padding: 'x'.repeat(30000) },
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'encryptionMeta')).toBe(
      true,
    );
  });
});
