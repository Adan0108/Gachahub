import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CompleteOnboardingDto,
  USERNAME_PATTERN,
} from './complete-onboarding.dto';

describe('USERNAME_PATTERN', () => {
  it.each([
    'bob',
    'Bob-12345',
    'Bob_12345',
    '123',
    'a-b',
    'a_b',
    'twentycharshandle123',
  ])('accepts %s', (value) => {
    expect(USERNAME_PATTERN.test(value)).toBe(true);
  });

  it.each([
    ['bo', 'too short'],
    ['a'.repeat(21), 'too long'],
    ['-bob', 'leading separator'],
    ['bob-', 'trailing separator'],
    ['_bob', 'leading underscore'],
    ['bob_', 'trailing underscore'],
    ['---', 'all separators'],
    ['___', 'all underscores'],
    ['a--b', 'consecutive dashes'],
    ['a__b', 'consecutive underscores'],
    ['a-_b', 'mixed consecutive separators'],
    ['a_-b', 'mixed consecutive separators reversed'],
    ['bob!', 'disallowed character'],
    ['bob 123', 'space'],
  ])('rejects %s (%s)', (value) => {
    expect(USERNAME_PATTERN.test(value)).toBe(false);
  });
});

describe('CompleteOnboardingDto', () => {
  const dto = (overrides: object = {}) =>
    plainToInstance(CompleteOnboardingDto, {
      name: 'Mado',
      username: 'Mado-123',
      ...overrides,
    });

  it('accepts a valid name and username', async () => {
    const errors = await validate(dto());

    expect(errors).toHaveLength(0);
  });

  it('trims the display name', () => {
    expect(dto({ name: '  Mado  ' }).name).toBe('Mado');
  });

  it('rejects a username with a leading separator', async () => {
    const errors = await validate(dto({ username: '-Mado' }));

    expect(errors.map((e) => e.property)).toContain('username');
  });

  it('rejects a one-character name', async () => {
    const errors = await validate(dto({ name: 'M' }));

    expect(errors.map((e) => e.property)).toContain('name');
  });
});
