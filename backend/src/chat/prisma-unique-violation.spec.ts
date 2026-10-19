import { Prisma } from '../generated/prisma/client';
import { isUniqueViolationOn } from './prisma-unique-violation';

const violation = (meta: Record<string, unknown>, code = 'P2002') =>
  new Prisma.PrismaClientKnownRequestError('clash', {
    code,
    clientVersion: 'test',
    meta,
  });

describe('isUniqueViolationOn', () => {
  it('recognises the classic engine, which lists the fields as the target', () => {
    const error = violation({ target: ['senderId', 'clientMessageId'] });

    expect(isUniqueViolationOn(error, 'clientMessageId')).toBe(true);
    expect(isUniqueViolationOn(error, 'userIdA')).toBe(false);
  });

  it('recognises a target given as one string', () => {
    expect(
      isUniqueViolationOn(
        violation({ target: 'chat_messages_senderId_clientMessageId_key' }),
        'clientMessageId',
      ),
    ).toBe(true);
  });

  it('recognises a driver adapter error, which reports the fields quoted and not as a target', () => {
    const error = violation({
      modelName: 'GameChannelMessage',
      driverAdapterError: {
        cause: {
          constraint: { fields: ['"authorId"', '"clientMessageId"'] },
        },
      },
    });

    expect(isUniqueViolationOn(error, 'clientMessageId')).toBe(true);
    expect(isUniqueViolationOn(error, 'authorId')).toBe(true);
    expect(isUniqueViolationOn(error, 'slug')).toBe(false);
  });

  it('is false for any other Prisma error', () => {
    expect(
      isUniqueViolationOn(
        violation({ target: ['clientMessageId'] }, 'P2025'),
        'clientMessageId',
      ),
    ).toBe(false);
  });

  it('is false when the error does not say which fields clashed', () => {
    expect(isUniqueViolationOn(violation({}), 'clientMessageId')).toBe(false);
  });

  it.each([
    ['an ordinary error', new Error('boom')],
    ['nothing', undefined],
    ['text', 'P2002'],
  ])('is false for %s', (_name, error) => {
    expect(isUniqueViolationOn(error, 'clientMessageId')).toBe(false);
  });
});
