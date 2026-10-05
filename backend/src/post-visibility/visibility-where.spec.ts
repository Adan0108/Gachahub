import { viewablePostWhere } from './visibility-where';

describe('viewablePostWhere', () => {
  it('only allows PUBLIC posts for an anonymous viewer', () => {
    expect(viewablePostWhere()).toEqual({
      status: 'PUBLISHED',
      deletedAt: null,
      visibility: 'PUBLIC',
    });
  });

  it('allows PUBLIC, the viewer\'s own FOLLOWERS_ONLY posts, and FOLLOWERS_ONLY posts from authors the viewer follows', () => {
    expect(viewablePostWhere('viewer-1')).toEqual({
      status: 'PUBLISHED',
      deletedAt: null,
      OR: [
        { visibility: 'PUBLIC' },
        { visibility: 'FOLLOWERS_ONLY', authorId: 'viewer-1' },
        {
          visibility: 'FOLLOWERS_ONLY',
          author: { followers: { some: { followerId: 'viewer-1' } } },
        },
      ],
    });
  });
});
