import {
  decodeEvidenceCursor,
  encodeEvidenceCursor,
} from './report-evidence-pagination';
import { projectReportSnapshot } from './report-evidence.projection';

describe('Case evidence projection and cursors', () => {
  it('round trips the immutable ordering boundary', () => {
    const cursor = {
      id: 'report',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    expect(decodeEvidenceCursor(encodeEvidenceCursor(cursor))).toEqual(cursor);
  });
  it.each([
    '',
    'bad!',
    'abc',
    Buffer.from(JSON.stringify({ id: 'x', createdAt: 'yesterday' })).toString(
      'base64url',
    ),
    Buffer.from('null').toString('base64url'),
  ])('rejects malformed cursor %s', (value) => {
    expect(decodeEvidenceCursor(value)).toBeNull();
  });
  it('allowlists evidence and media fields without exposing storage internals', () => {
    const snapshot = projectReportSnapshot(
      {
        version: 1,
        targetType: 'POST',
        postId: 'post',
        content: 'historical',
        title: 'old',
        secret: 'hidden',
        media: [
          {
            url: 'image',
            publicId: 'secret',
            assetId: 'secret',
            mediaType: 'IMAGE',
            altText: null,
          },
        ],
      },
      'POST',
      'post',
    );
    expect(snapshot).toMatchObject({
      targetId: 'post',
      content: 'historical',
      title: 'old',
      media: [{ url: 'image', mediaType: 'IMAGE', altText: null }],
    });
    expect(snapshot).not.toHaveProperty('secret');
    expect(snapshot?.media[0]).not.toHaveProperty('assetId');
  });
  it('projects comment evidence separately', () => {
    expect(
      projectReportSnapshot(
        {
          version: 1,
          targetType: 'COMMENT',
          commentId: 'comment',
          postId: 'post',
          parentId: 'parent',
          content: 'old comment',
        },
        'COMMENT',
        'comment',
      ),
    ).toMatchObject({
      content: 'old comment',
      postId: 'post',
      parentId: 'parent',
      title: null,
      media: [],
    });
  });
  it.each([
    null,
    {},
    { version: 2 },
    { version: 1, targetType: 'POST', postId: 'other', content: 'x' },
  ])('handles absent, unknown or mismatched snapshot %j', (snapshot) => {
    expect(projectReportSnapshot(snapshot, 'POST', 'post')).toBeNull();
  });
});
