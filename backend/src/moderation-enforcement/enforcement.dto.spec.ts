import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { AdjustSanctionDto, SanctionDto } from './enforcement.dto';
const base = {
  reason: 'An explicit moderator decision',
  requestKey: '01a9b8d9-2e18-41ed-9167-55b2cd28d3ef',
};
const errors = (value: object) =>
  validate(plainToInstance(SanctionDto, { ...base, ...value }), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('MVP sanction request boundary', () => {
  it.each(['PERMANENT_BAN', 'PLATFORM_READ_ONLY', 'INDEFINITE'])(
    'rejects unsupported %s',
    async (type) =>
      expect((await errors({ type, durationDays: 30 })).length).toBeGreaterThan(
        0,
      ),
  );
  it.each([undefined, null, 0, -1, 31, 365, 1.5])(
    'rejects temporary duration %s',
    async (durationDays) => {
      for (const type of [
        'COMMUNITY_RESTRICTION',
        'COMMUNITY_BAN',
        'PLATFORM_SUSPENSION',
      ])
        expect((await errors({ type, durationDays })).length).toBeGreaterThan(
          0,
        );
    },
  );
  it.each([1, 3, 7, 30])('allows the %s-day preset', async (durationDays) =>
    expect(
      await errors({ type: 'PLATFORM_SUSPENSION', durationDays }),
    ).toHaveLength(0),
  );
  it('rejects supplied expiry and obsolete permanent confirmation fields', async () => {
    expect(
      (
        await errors({
          type: 'PLATFORM_SUSPENSION',
          durationDays: 7,
          expiresAt: null,
        })
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await errors({
          type: 'PLATFORM_SUSPENSION',
          durationDays: 7,
          confirmPermanent: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([null, 0, 31, 365])(
    'rejects adjustment duration %s',
    async (durationDays) =>
      expect(
        (
          await validate(
            plainToInstance(AdjustSanctionDto, {
              reason: base.reason,
              durationDays,
            }),
          )
        ).length,
      ).toBeGreaterThan(0),
  );
  it.each(['BANNED', 'SUSPENDED'])(
    'rejects legacy indefinite status %s',
    async (status) =>
      expect(
        (await validate(plainToInstance(UpdateUserStatusDto, { status })))
          .length,
      ).toBeGreaterThan(0),
  );
  it('keeps warnings informational and rejects an explicitly null warning duration', async () => {
    expect(await errors({ type: 'WARNING' })).toHaveLength(0);
    expect(
      (await errors({ type: 'WARNING', durationDays: null })).length,
    ).toBeGreaterThan(0);
  });
});
