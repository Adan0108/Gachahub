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

  describe('sendLinkPreviews', () => {
    it.each([true, false])('allows %s', async (value) => {
      const dto = plainToInstance(UpdateProfileDto, {
        sendLinkPreviews: value,
      });

      expect(await validate(dto)).toHaveLength(0);
    });

    it.each([null, 'yes', 1, 'true'])('rejects %p', async (value) => {
      const dto = plainToInstance(UpdateProfileDto, {
        sendLinkPreviews: value,
      });

      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('sendLinkPreviews');
    });
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

  describe('name', () => {
    it('trims the name and allows 2 to 50 characters', async () => {
      const dto = plainToInstance(UpdateProfileDto, { name: '  Yumemi  ' });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.name).toBe('Yumemi');
    });

    it.each([null, 5, '', ' a ', 'x'.repeat(51)])(
      'rejects %p',
      async (value) => {
        const dto = plainToInstance(UpdateProfileDto, { name: value });

        const errors = await validate(dto);

        expect(errors).toHaveLength(1);
        expect(errors[0].property).toBe('name');
      },
    );
  });

  describe('bio', () => {
    it('allows up to 160 characters, and an empty one that clears it', async () => {
      for (const bio of ['', 'x'.repeat(160), '  hello  ']) {
        const dto = plainToInstance(UpdateProfileDto, { bio });
        expect(await validate(dto)).toHaveLength(0);
      }
      expect(plainToInstance(UpdateProfileDto, { bio: '  hello  ' }).bio).toBe(
        'hello',
      );
    });

    it.each([null, 5, 'x'.repeat(161)])('rejects %p', async (value) => {
      const dto = plainToInstance(UpdateProfileDto, { bio: value });

      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('bio');
    });
  });
});
