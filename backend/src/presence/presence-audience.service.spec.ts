import { PresenceAudienceService } from './presence-audience.service';
import { PRESENCE_AUDIENCE_LIMIT } from './presence.constants';

describe('PresenceAudienceService', () => {
  const chatAccess = { findAcceptedChatPartnerIds: jest.fn() };
  const blocks = { getMutuallyBlockedIdsAmong: jest.fn() };
  let service: PresenceAudienceService;

  beforeEach(() => {
    jest.resetAllMocks();
    chatAccess.findAcceptedChatPartnerIds.mockResolvedValue([]);
    blocks.getMutuallyBlockedIdsAmong.mockResolvedValue(new Set());
    service = new PresenceAudienceService(chatAccess as never, blocks as never);
  });

  const sharing = (...ids: string[]) =>
    chatAccess.findAcceptedChatPartnerIds.mockResolvedValue(ids);

  describe('findAudienceIds', () => {
    it('is the people in an accepted chat with the person', async () => {
      sharing('bo', 'cy');

      await expect(service.findAudienceIds('me')).resolves.toEqual([
        'bo',
        'cy',
      ]);
      expect(chatAccess.findAcceptedChatPartnerIds).toHaveBeenCalledWith('me', {
        limit: PRESENCE_AUDIENCE_LIMIT,
        among: undefined,
      });
    });

    it('leaves out anyone blocked either way', async () => {
      sharing('bo', 'cy', 'di');
      blocks.getMutuallyBlockedIdsAmong.mockResolvedValue(
        new Set(['bo', 'cy']),
      );

      await expect(service.findAudienceIds('me')).resolves.toEqual(['di']);
      expect(blocks.getMutuallyBlockedIdsAmong).toHaveBeenCalledWith('me', [
        'bo',
        'cy',
        'di',
      ]);
    });

    it('does not look for blocks when nobody shares a chat', async () => {
      await expect(service.findAudienceIds('me')).resolves.toEqual([]);
      expect(blocks.getMutuallyBlockedIdsAmong).not.toHaveBeenCalled();
    });
  });

  describe('findVisibleAmong', () => {
    it('only considers the people asked about', async () => {
      sharing('bo');

      const visible = await service.findVisibleAmong('me', ['bo', 'zed']);

      expect([...visible]).toEqual(['bo']);
      expect(chatAccess.findAcceptedChatPartnerIds).toHaveBeenCalledWith('me', {
        limit: PRESENCE_AUDIENCE_LIMIT,
        among: ['bo', 'zed'],
      });
    });

    it('hides a person the viewer blocked, and one who blocked the viewer', async () => {
      sharing('bo', 'cy', 'di');
      blocks.getMutuallyBlockedIdsAmong.mockResolvedValue(
        new Set(['bo', 'cy']),
      );

      const visible = await service.findVisibleAmong('me', ['bo', 'cy', 'di']);

      expect([...visible]).toEqual(['di']);
    });

    it('asks nothing for an empty list', async () => {
      await expect(service.findVisibleAmong('me', [])).resolves.toEqual(
        new Set(),
      );
      expect(chatAccess.findAcceptedChatPartnerIds).not.toHaveBeenCalled();
    });
  });
});
