import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ExternalJoinDto } from './external-join.dto';

const validPayload = Buffer.from('commit-bytes').toString('base64');

describe('ExternalJoinDto', () => {
  it('accepts a request with a snapshot', async () => {
    const dto = plainToInstance(ExternalJoinDto, {
      deviceId: 'device-1',
      epoch: 0,
      payload: validPayload,
      groupInfo: Buffer.from('group-info-bytes').toString('base64'),
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  // regression: a group whose GroupInfo is too big to publish must still be able to join by itself -
  // the client omits the field entirely rather than sending nothing, and this must not be a 400.
  it('accepts a request with the snapshot omitted, for a group too big to publish one', async () => {
    const dto = plainToInstance(ExternalJoinDto, {
      deviceId: 'device-1',
      epoch: 0,
      payload: validPayload,
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('still refuses a snapshot over the size cap when one is sent', async () => {
    const dto = plainToInstance(ExternalJoinDto, {
      deviceId: 'device-1',
      epoch: 0,
      payload: validPayload,
      groupInfo: Buffer.from('x'.repeat(60_000)).toString('base64'),
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'groupInfo')).toBe(true);
  });
});
