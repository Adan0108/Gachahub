import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryChatConversationsDto } from './query-chat-conversations.dto';

const check = (query: Record<string, unknown>) =>
  validate(plainToInstance(QueryChatConversationsDto, query));

describe('QueryChatConversationsDto', () => {
  it.each([
    [{}],
    [{ limit: '50' }],
    [
      {
        limit: '50',
        beforeUpdatedAt: '2024-01-05T00:00:00.000Z',
        beforeId: 'conv-1',
      },
    ],
  ])('accepts %j', async (query) => {
    expect(await check(query)).toHaveLength(0);
  });

  it.each([
    [{ limit: '50', beforeId: 'conv-1' }],
    [{ limit: '50', beforeUpdatedAt: '2024-01-05T00:00:00.000Z' }],
    [{ beforeUpdatedAt: '2024-01-05T00:00:00.000Z', beforeId: 'conv-1' }],
  ])('refuses a half or limitless cursor %j', async (query) => {
    expect((await check(query)).length).toBeGreaterThan(0);
  });
});
