import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReactToMessageDto } from './react-to-message.dto';

const check = (body: Record<string, unknown>) =>
  validate(plainToInstance(ReactToMessageDto, body));

describe('ReactToMessageDto', () => {
  it.each([['😀'], ['👍🏽'], ['🇻🇳'], ['👨‍👩‍👧‍👦'], ['🔟'], ['❤️']])(
    'accepts the emoji %s',
    async (emoji) => {
      expect(await check({ emoji })).toHaveLength(0);
    },
  );

  it.each([
    ['text', 'hello'],
    ['two emoji', '😀😀'],
    ['an emoji with text', '😀 hi'],
    ['markup', '<b>x</b>'],
    ['a digit', '1'],
    ['an empty string', ''],
    ['spaces', '   '],
  ])('refuses %s', async (_name, emoji) => {
    expect((await check({ emoji })).length).toBeGreaterThan(0);
  });

  it('accepts an emoji with stray spaces and keeps only the emoji', async () => {
    const dto = plainToInstance(ReactToMessageDto, { emoji: ' 😋 ' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.emoji).toBe('😋');
  });

  it('trims an emote id too', async () => {
    const dto = plainToInstance(ReactToMessageDto, { emoteId: ' cm123 ' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.emoteId).toBe('cm123');
  });

  it('refuses something that is not text', async () => {
    expect((await check({ emoji: 42 })).length).toBeGreaterThan(0);
  });

  it('accepts a custom emote id on its own', async () => {
    expect(await check({ emoteId: 'cm123emote' })).toHaveLength(0);
  });

  it('refuses a reaction with neither', async () => {
    expect((await check({})).length).toBeGreaterThan(0);
  });

  it('refuses a reaction with both', async () => {
    expect(
      (await check({ emoji: '😀', emoteId: 'cm123emote' })).length,
    ).toBeGreaterThan(0);
  });

  it('refuses an emote id that is far too long', async () => {
    expect((await check({ emoteId: 'x'.repeat(121) })).length).toBeGreaterThan(
      0,
    );
  });
});
