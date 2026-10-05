import { NotificationEntityType } from '../generated/prisma/client';
import { commentEntityIds, withPostIds } from './notification.mapper';

const comment = (id: string, entityId: string) => ({
  id,
  entityType: NotificationEntityType.COMMENT,
  entityId,
});
const post = (id: string) => ({
  id,
  entityType: NotificationEntityType.POST,
  entityId: 'post-1',
});

describe('notification mapper', () => {
  it('picks out only the comment entity ids', () => {
    expect(
      commentEntityIds([comment('n1', 'c1'), post('n2'), comment('n3', 'c3')]),
    ).toEqual(['c1', 'c3']);
  });

  it('gives comment notifications the post they sit on and everything else null', () => {
    const result = withPostIds(
      [comment('n1', 'c1'), post('n2')],
      new Map([['c1', 'post-9']]),
    );

    expect(result.map((item) => item.postId)).toEqual(['post-9', null]);
  });

  it('gives a comment with no resolvable post a null post id', () => {
    expect(
      withPostIds([comment('n1', 'gone')], new Map())[0].postId,
    ).toBeNull();
  });
});
