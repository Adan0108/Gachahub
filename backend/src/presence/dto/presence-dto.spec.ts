import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryPresenceDto } from './query-presence.dto';
import { SetPresenceDto } from './set-presence.dto';

const check = async <T extends object>(type: new () => T, plain: object) =>
  validate(plainToInstance(type, plain));

describe('SetPresenceDto', () => {
  it('accepts going online, and invisible with each duration', async () => {
    expect(await check(SetPresenceDto, { status: 'ONLINE' })).toHaveLength(0);
    for (const duration of ['15m', '1h', '8h', '24h', '3d', 'forever']) {
      expect(
        await check(SetPresenceDto, { status: 'INVISIBLE', duration }),
      ).toHaveLength(0);
    }
  });

  it('refuses other statuses, such as idle, and unknown durations', async () => {
    expect(await check(SetPresenceDto, { status: 'IDLE' })).not.toHaveLength(0);
    expect(await check(SetPresenceDto, { status: 'DND' })).not.toHaveLength(0);
    expect(
      await check(SetPresenceDto, { status: 'INVISIBLE', duration: '2h' }),
    ).not.toHaveLength(0);
  });
});

describe('QueryPresenceDto', () => {
  const parse = (userIds: unknown) =>
    plainToInstance(QueryPresenceDto, { userIds });

  it('splits comma separated ids and drops blanks and repeats', () => {
    expect(parse('a,b,,a').userIds).toEqual(['a', 'b']);
  });

  it('needs at least one id and at most 100', async () => {
    expect(await validate(parse(''))).not.toHaveLength(0);
    const many = Array.from({ length: 101 }, (_, index) => `u${index}`).join(
      ',',
    );
    expect(await validate(parse(many))).not.toHaveLength(0);
    expect(await validate(parse('a,b'))).toHaveLength(0);
  });
});
