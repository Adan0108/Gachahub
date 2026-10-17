import { ForbiddenException } from '@nestjs/common';
import { CommunityChatGateway } from './community-chat.gateway';
import { communityRoom } from './community-realtime.service';

describe('CommunityChatGateway', () => {
  const access = { scope: jest.fn(), channelIn: jest.fn() };
  let gateway: CommunityChatGateway;

  const socket = (userId: string | undefined = 'me') => ({
    data: { userId, authReady: Promise.resolve() },
    join: jest.fn(),
    leave: jest.fn(),
  });

  beforeEach(() => {
    jest.resetAllMocks();
    access.scope.mockResolvedValue({ game: { id: 'g1' } });
    access.channelIn.mockResolvedValue({ id: 'c1' });
    gateway = new CommunityChatGateway(access as never);
  });

  it('puts a member who may read the room into it', async () => {
    const s = socket();

    await expect(
      gateway.join(s as never, { slug: 'wuwa', channelId: 'c1' }),
    ).resolves.toEqual({ ok: true });

    expect(access.scope).toHaveBeenCalledWith('wuwa', 'me');
    expect(access.channelIn).toHaveBeenCalledWith('g1', 'c1');
    expect(s.join).toHaveBeenCalledWith(communityRoom('c1'));
  });

  it('refuses someone who has not joined the community, and joins nothing', async () => {
    access.scope.mockRejectedValue(new ForbiddenException());
    const s = socket();

    await expect(
      gateway.join(s as never, { slug: 'wuwa', channelId: 'c1' }),
    ).resolves.toEqual({ ok: false });
    expect(s.join).not.toHaveBeenCalled();
  });

  it('refuses a room that is not in that community', async () => {
    access.channelIn.mockRejectedValue(new Error('not found'));
    const s = socket();

    await expect(
      gateway.join(s as never, { slug: 'wuwa', channelId: 'elsewhere' }),
    ).resolves.toEqual({ ok: false });
    expect(s.join).not.toHaveBeenCalled();
  });

  it('refuses a socket that is not signed in, or a malformed request', async () => {
    const anonymous = { ...socket(), data: { authReady: Promise.resolve() } };
    await expect(
      gateway.join(anonymous as never, { slug: 'wuwa', channelId: 'c1' }),
    ).resolves.toEqual({ ok: false });

    await expect(
      gateway.join(socket() as never, { slug: 1, channelId: {} }),
    ).resolves.toEqual({ ok: false });
    expect(access.scope).not.toHaveBeenCalled();
  });

  it('lets a socket leave a room', async () => {
    const s = socket();

    await expect(
      gateway.leave(s as never, { channelId: 'c1' }),
    ).resolves.toEqual({ ok: true });
    expect(s.leave).toHaveBeenCalledWith(communityRoom('c1'));
  });
});
