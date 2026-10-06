import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto', () => {
  it('allows the field to be omitted entirely', async () => {
    const dto = plainToInstance(UpdateProfileDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('allows a valid enum value', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      messageRequestSetting: 'FOLLOWERS',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  // regression: @IsOptional() used to let an explicit null through
  // unchanged, which then crashed Prisma on a non-nullable enum column
  it('rejects an explicit null instead of letting it through', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      messageRequestSetting: null,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('messageRequestSetting');
  });

  it('rejects an invalid enum value', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      messageRequestSetting: 'NOT_A_REAL_SETTING',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });

  describe('sendReadReceipts', () => {
    it.each([true, false])('allows %s', async (value) => {
      const dto = plainToInstance(UpdateProfileDto, {
        sendReadReceipts: value,
      });

      expect(await validate(dto)).toHaveLength(0);
    });

    it.each([null, 'yes', 1, 'true'])('rejects %p', async (value) => {
      const dto = plainToInstance(UpdateProfileDto, {
        sendReadReceipts: value,
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('sendReadReceipts');
    });
  });
});
