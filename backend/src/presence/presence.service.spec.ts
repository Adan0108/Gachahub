import { BadRequestException } from '@nestjs/common';
import { userRoom } from '../websocket/socket.util';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  const store = {
    getInvisible: jest.fn(),
    connectedAmong: jest.fn(),
    onlineAmong: jest.fn(),
    startLingering: jest.fn(),
    stopLingering: jest.fn(),
    popLingerDue: jest.fn(),
    invisibleAmong: jest.fn(),
    setInvisible: jest.fn(),
    clearInvisible: jest.fn(),
    touchSocket: jest.fn(),
    dropSocket: jest.fn(),
    popExpired: jest.fn(),
  };
  const audience = {
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
    store.onlineAmong.mockResolvedValue(new Set(['me']));
    store.stopLingering.mockResolvedValue(false);
    store.popExpired.mockResolvedValue([]);
    store.popLingerDue.mockResolvedValue([]);
    audience.findAudienceIds.mockResolvedValue(['bo', 'cy']);
    service = new PresenceService(
      store as never,
      audience as never,
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
      audience.findVisibleAmong.mockResolvedValue(
        new Set(['on', 'hidden', 'away']),
      );
      store.onlineAmong.mockResolvedValue(new Set(['on', 'hidden']));
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
      audience.findVisibleAmong.mockResolvedValue(new Set(['on']));
      store.onlineAmong.mockResolvedValue(new Set());

      await service.getVisible('me', ['on', 'stranger']);

      expect(store.onlineAmong).toHaveBeenCalledWith(['on'], NOW);
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

    it('keeps others seeing them online for a random one to three minutes after the last socket goes, announcing nothing', async () => {
      const random = jest.spyOn(Math, 'random');

      store.dropSocket.mockResolvedValue(1);
      await service.socketGone('me', 's1');
      expect(store.startLingering).not.toHaveBeenCalled();

      store.dropSocket.mockResolvedValue(0);
      random.mockReturnValueOnce(0);
      await service.socketGone('me', 's2');
      random.mockReturnValueOnce(0.999999);
      await service.socketGone('me', 's3');
      random.mockReturnValueOnce(0.5);
      await service.socketGone('me', 's4');

      const untils = store.startLingering.mock.calls.map(
        ([, until]) => (until as number) - NOW,
      );
      expect(untils[0]).toBe(60_000);
      expect(untils[1]).toBe(180_000);
      expect(untils[2]).toBeGreaterThan(60_000);
      expect(untils[2]).toBeLessThan(180_000);
      expect(emit).not.toHaveBeenCalled();
      random.mockRestore();
    });

    it('does not announce coming back when others never saw them leave', async () => {
      store.touchSocket.mockResolvedValue({ added: true, count: 1 });
      store.stopLingering.mockResolvedValue(true);

      await service.socketAlive('me', 's1');

      expect(emit).not.toHaveBeenCalled();
    });

    it('says nothing when nobody can see the person', async () => {
      audience.findAudienceIds.mockResolvedValue([]);
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

    it('shows someone offline once their grace has run out', async () => {
      store.popLingerDue.mockResolvedValue(['me']);
      store.connectedAmong.mockResolvedValue(new Set());
      store.onlineAmong.mockResolvedValue(new Set());

      await service.expireDue();

      expect(emit).toHaveBeenCalledWith('presence:update', {
        userId: 'me',
        status: 'OFFLINE',
      });
    });

    it('leaves alone someone who came back while their grace was running', async () => {
      store.popLingerDue.mockResolvedValue(['me']);
      store.connectedAmong.mockResolvedValue(new Set(['me']));

      await service.expireDue();

      expect(emit).not.toHaveBeenCalled();
    });

    it('does nothing when no one is due', async () => {
      store.popExpired.mockResolvedValue([]);

      await service.expireDue();

      expect(emit).not.toHaveBeenCalled();
    });
  });
});
