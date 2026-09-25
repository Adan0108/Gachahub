import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubmitHandshakeDto } from './submit-handshake.dto';

const validPayload = Buffer.from('commit-bytes').toString('base64');
const validWelcomePayload = Buffer.from('welcome-bytes').toString('base64');

describe('SubmitHandshakeDto', () => {
  it('accepts one Welcome addressed to several distinct devices', async () => {
    const dto = plainToInstance(SubmitHandshakeDto, {
      deviceId: 'device-1',
      epoch: 0,
      payload: validPayload,
      addedDeviceIds: ['device-2', 'device-3'],
      removedDeviceIds: [],
      welcome: {
        recipientDeviceIds: ['device-2', 'device-3'],
        payload: validWelcomePayload,
      },
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  describe('the Welcome', () => {
    const withWelcome = (welcome: object) =>
      plainToInstance(SubmitHandshakeDto, {
        deviceId: 'device-1',
        epoch: 0,
        payload: validPayload,
        addedDeviceIds: ['device-2'],
        removedDeviceIds: [],
        welcome,
      });

    const nestedProperties = async (welcome: object) =>
      (await validate(withWelcome(welcome))).flatMap((error) =>
        (error.children ?? []).map((child) => child.property),
      );

    // regression: a repeated recipient would be stored as duplicate mls_welcomes rows
    it('rejects the same recipient device more than once', async () => {
      expect(
        await nestedProperties({
          recipientDeviceIds: ['device-2', 'device-2'],
          payload: validWelcomePayload,
        }),
      ).toContain('recipientDeviceIds');
    });

    it('rejects no recipients, more than 50, or an oversized id', async () => {
      const many = Array.from({ length: 51 }, (_, i) => `d${i}`);

      for (const recipientDeviceIds of [[], many, ['x'.repeat(65)]]) {
        expect(
          await nestedProperties({
            recipientDeviceIds,
            payload: validWelcomePayload,
          }),
        ).toContain('recipientDeviceIds');
      }
    });

    it('rejects a payload over the size cap', async () => {
      expect(
        await nestedProperties({
          recipientDeviceIds: ['device-2'],
          payload: 'A'.repeat(20004),
        }),
      ).toContain('payload');
    });
  });

  describe('the published snapshot (groupInfo)', () => {
    const valid = {
      deviceId: 'device-1',
      epoch: 1,
      payload: validPayload,
      addedDeviceIds: [],
      removedDeviceIds: [],
    };

    // regression: a group too big to publish a snapshot for must still be able to accept ordinary
    // Commits - the client omits the field entirely, and this must not be a 400 on every add/remove.
    it('accepts a Commit with the snapshot omitted', async () => {
      const errors = await validate(plainToInstance(SubmitHandshakeDto, valid));

      expect(errors).toHaveLength(0);
    });

    it('accepts a Commit with a snapshot under the cap', async () => {
      const dto = plainToInstance(SubmitHandshakeDto, {
        ...valid,
        groupInfo: Buffer.from('group-info-bytes').toString('base64'),
      });

      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects a snapshot over the size cap', async () => {
      const dto = plainToInstance(SubmitHandshakeDto, {
        ...valid,
        groupInfo: Buffer.from('x'.repeat(60_000)).toString('base64'),
      });

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'groupInfo')).toBe(true);
    });
  });

  describe('declared membership changes', () => {
    const valid = {
      deviceId: 'device-1',
      epoch: 1,
      payload: validPayload,
      addedDeviceIds: [],
      removedDeviceIds: [],
    };

    const propertiesWithErrors = async (input: object) =>
      (await validate(plainToInstance(SubmitHandshakeDto, input))).map(
        (error) => error.property,
      );

    it('refuses an epoch beyond what the database column holds', async () => {
      expect(
        await propertiesWithErrors({ ...valid, epoch: 2_147_483_648 }),
      ).toContain('epoch');
    });

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
