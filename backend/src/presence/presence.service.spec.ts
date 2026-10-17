import { BadRequestException } from '@nestjs/common';
import { userRoom } from '../websocket/socket.util';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  const store = {
    getInvisible: jest.fn(),
    connectedAmong: jest.fn(),
    invisibleAmong: jest.fn(),
    setInvisible: jest.fn(),
    clearInvisible: jest.fn(),
    touchSocket: jest.fn(),
    dropSocket: jest.fn(),
    popExpired: jest.fn(),
  };
  const repository = {
    findVisibleAmong: jest.fn(),
    findAudienceIds: jest.fn(),
  };
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const registry = { server: { to } };

  let service: PresenceService;

  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    to.mockReturnValue({ emit });
    store.getInvisible.mockResolvedValue(null);
    store.connectedAmong.mockResolvedValue(new Set(['me']));
    store.invisibleAmong.mockResolvedValue(new Set());
    repository.findAudienceIds.mockResolvedValue(['bo', 'cy']);
    service = new PresenceService(
      store as never,
      repository as never,
      registry as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('getMine', () => {
    it('is online when nothing was chosen, or the choice has ended', async () => {
      await expect(service.getMine('me')).resolves.toEqual({
        status: 'ONLINE',
        until: null,
      });

      store.getInvisible.mockResolvedValue({ until: NOW - 1 });
      await expect(service.getMine('me')).resolves.toEqual({
        status: 'ONLINE',
        until: null,
      });
    });

    it('says when a timed invisibility ends, and nothing for forever', async () => {
      store.getInvisible.mockResolvedValue({ until: NOW + 60_000 });
      await expect(service.getMine('me')).resolves.toEqual({
        status: 'INVISIBLE',
        until: new Date(NOW + 60_000).toISOString(),
      });

      store.getInvisible.mockResolvedValue({ until: null });
      await expect(service.getMine('me')).resolves.toEqual({
        status: 'INVISIBLE',
        until: null,
      });
    });
  });

  describe('getVisible', () => {
    it('shows online only for visible, connected people who are not invisible', async () => {
      repository.findVisibleAmong.mockResolvedValue(
        new Set(['on', 'hidden', 'away']),
      );
      store.connectedAmong.mockResolvedValue(new Set(['on', 'hidden']));
      store.invisibleAmong.mockResolvedValue(new Set(['hidden']));

      const result = await service.getVisible('me', [
        'on',
        'hidden',
        'away',
        'stranger',
      ]);

      expect(result).toEqual({
        on: 'ONLINE',
        hidden: 'OFFLINE',
        away: 'OFFLINE',
        stranger: 'OFFLINE',
      });
    });

    it('does not even look up connection or choice for people the viewer may not see', async () => {
      repository.findVisibleAmong.mockResolvedValue(new Set(['on']));
      store.connectedAmong.mockResolvedValue(new Set());

      await service.getVisible('me', ['on', 'stranger']);

      expect(store.connectedAmong).toHaveBeenCalledWith(['on'], NOW);
      expect(store.invisibleAmong).toHaveBeenCalledWith(['on'], NOW);
    });
  });

  describe('setMine', () => {
    it('goes online by clearing the choice, and tells the person and their audience', async () => {
      store.getInvisible.mockResolvedValue(null);

      const mine = await service.setMine('me', { status: 'ONLINE' });

      expect(store.clearInvisible).toHaveBeenCalledWith('me');
      expect(mine).toEqual({ status: 'ONLINE', until: null });
      expect(to).toHaveBeenCalledWith(userRoom('me'));
      expect(emit).toHaveBeenCalledWith('presence:self', mine);
      expect(to).toHaveBeenCalledWith([userRoom('bo'), userRoom('cy')]);
      expect(emit).toHaveBeenCalledWith('presence:update', {
        userId: 'me',
        status: 'ONLINE',
      });
    });

    it.each([
      ['15m', 15 * 60_000],
      ['1h', 60 * 60_000],
      ['8h', 8 * 60 * 60_000],
      ['24h', 24 * 60 * 60_000],
      ['3d', 72 * 60 * 60_000],
    ] as const)('stays invisible for %s from now', async (duration, ms) => {
      await service.setMine('me', { status: 'INVISIBLE', duration });

      expect(store.setInvisible).toHaveBeenCalledWith('me', NOW + ms);
    });

    it('stays invisible with no end for forever, and others now see offline', async () => {
      store.invisibleAmong.mockResolvedValue(new Set(['me']));

      await service.setMine('me', { status: 'INVISIBLE', duration: 'forever' });

      expect(store.setInvisible).toHaveBeenCalledWith('me', null);
      expect(emit).toHaveBeenCalledWith('presence:update', {
        userId: 'me',
        status: 'OFFLINE',
      });
    });

    it('needs a duration to go invisible', async () => {
      await expect(
        service.setMine('me', { status: 'INVISIBLE' }),
      ).rejects.toThrow(BadRequestException);
      expect(store.setInvisible).not.toHaveBeenCalled();
    });
  });

  describe('sockets', () => {
    it('announces when a first socket appears', async () => {
      store.touchSocket.mockResolvedValue({ added: true, count: 1 });

      await service.socketAlive('me', 's1');

      expect(emit).toHaveBeenCalledWith('presence:update', {
        userId: 'me',
        status: 'ONLINE',
      });
    });

    it('stays quiet for a ping, or for a second tab', async () => {
      store.touchSocket.mockResolvedValue({ added: false, count: 1 });
      await service.socketAlive('me', 's1');

      store.touchSocket.mockResolvedValue({ added: true, count: 2 });
      await service.socketAlive('me', 's2');

      expect(emit).not.toHaveBeenCalled();
    });

    it('announces offline only when the last socket goes', async () => {
      store.connectedAmong.mockResolvedValue(new Set());

      store.dropSocket.mockResolvedValue(1);
      await service.socketGone('me', 's1');
      expect(emit).not.toHaveBeenCalled();

      store.dropSocket.mockResolvedValue(0);
      await service.socketGone('me', 's2');
      expect(emit).toHaveBeenCalledWith('presence:update', {
        userId: 'me',
        status: 'OFFLINE',
      });
    });

    it('says nothing when nobody can see the person', async () => {
      repository.findAudienceIds.mockResolvedValue([]);
      store.touchSocket.mockResolvedValue({ added: true, count: 1 });

      await service.socketAlive('me', 's1');

      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('expireDue', () => {
    it('brings everyone whose time is up back, telling them and their audience', async () => {
      store.popExpired.mockResolvedValue(['me']);

      await service.expireDue();

      expect(emit).toHaveBeenCalledWith('presence:self', {
        status: 'ONLINE',
        until: null,
      });
      expect(emit).toHaveBeenCalledWith('presence:update', {
        userId: 'me',
        status: 'ONLINE',
      });
    });

    it('does nothing when no one is due', async () => {
      store.popExpired.mockResolvedValue([]);

      await service.expireDue();

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
