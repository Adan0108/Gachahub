import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubmitHandshakeDto } from './submit-handshake.dto';

const validPayload = Buffer.from('commit-bytes').toString('base64');
const validWelcomePayload = Buffer.from('welcome-bytes').toString('base64');

describe('SubmitHandshakeDto', () => {
  it('accepts welcomes addressed to distinct devices', async () => {
    const dto = plainToInstance(SubmitHandshakeDto, {
      deviceId: 'device-1',
      epoch: 0,
      payload: validPayload,
      welcomes: [
        { recipientDeviceId: 'device-2', payload: validWelcomePayload },
        { recipientDeviceId: 'device-3', payload: validWelcomePayload },
      ],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  // regression: nothing else rejected the same recipientDeviceId appearing
  // more than once - a client could submit 50 duplicate entries and have
  // all 50 accepted as separate mls_welcomes rows for the same device.
  it('rejects the same recipientDeviceId appearing more than once', async () => {
    const dto = plainToInstance(SubmitHandshakeDto, {
      deviceId: 'device-1',
      epoch: 0,
      payload: validPayload,
      welcomes: [
        { recipientDeviceId: 'device-2', payload: validWelcomePayload },
        { recipientDeviceId: 'device-2', payload: validWelcomePayload },
      ],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'welcomes')).toBe(true);
  });
});
