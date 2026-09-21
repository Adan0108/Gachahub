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
      addedDeviceIds: ['device-2', 'device-3'],
      removedDeviceIds: [],
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
      addedDeviceIds: ['device-2'],
      removedDeviceIds: [],
      welcomes: [
        { recipientDeviceId: 'device-2', payload: validWelcomePayload },
        { recipientDeviceId: 'device-2', payload: validWelcomePayload },
      ],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'welcomes')).toBe(true);
  });

  describe('declared membership changes', () => {
    const valid = {
      deviceId: 'device-1',
      epoch: 1,
      payload: validPayload,
      welcomes: [],
      addedDeviceIds: [],
      removedDeviceIds: [],
    };

    const propertiesWithErrors = async (input: object) =>
      (await validate(plainToInstance(SubmitHandshakeDto, input))).map(
        (error) => error.property,
      );

    it('accepts a Commit that declares no changes', async () => {
      expect(await propertiesWithErrors(valid)).toEqual([]);
    });

    // the server validates against what is declared, so leaving it out must
    // be refused rather than read as "changes no one"
    it.each(['addedDeviceIds', 'removedDeviceIds'])(
      'requires %s',
      async (field) => {
        const rest: Record<string, unknown> = { ...valid };
        delete rest[field];

        expect(await propertiesWithErrors(rest)).toContain(field);
      },
    );

    it.each(['addedDeviceIds', 'removedDeviceIds'])(
      'rejects the same device twice in %s',
      async (field) => {
        expect(
          await propertiesWithErrors({ ...valid, [field]: ['d1', 'd1'] }),
        ).toContain(field);
      },
    );

    it.each(['addedDeviceIds', 'removedDeviceIds'])(
      'rejects more than 50 devices in %s',
      async (field) => {
        const many = Array.from({ length: 51 }, (_, i) => `d${i}`);

        expect(
          await propertiesWithErrors({ ...valid, [field]: many }),
        ).toContain(field);
      },
    );

    it.each(['addedDeviceIds', 'removedDeviceIds'])(
      'rejects an empty or oversized device id in %s',
      async (field) => {
        expect(
          await propertiesWithErrors({ ...valid, [field]: [''] }),
        ).toContain(field);
        expect(
          await propertiesWithErrors({ ...valid, [field]: ['x'.repeat(65)] }),
        ).toContain(field);
      },
    );
  });
});
