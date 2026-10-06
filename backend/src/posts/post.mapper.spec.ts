import { formatPost } from './post.mapper';

describe('formatPost save state', () => {
  it('maps the scoped save relation and strips private relations', () => {
    expect(
      formatPost({
        id: 'post',
        tags: [{ tag: { name: 'tag' } }],
        postSaves: [{ userId: 'viewer' }],
        postLikes: [],
      }),
    ).toEqual({
      id: 'post',
      tags: [{ name: 'tag' }],
      savedByCurrentUser: true,
      likedByCurrentUser: false,
    });
  });
  it('defaults to false for absent (anonymous) or empty relations', () => {
    expect(formatPost({ tags: [] }).savedByCurrentUser).toBe(false);
    expect(formatPost({ tags: [], postSaves: [] }).savedByCurrentUser).toBe(
      false,
    );
  });
});
