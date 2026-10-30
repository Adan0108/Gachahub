import { createHash } from 'node:crypto';
import type { PostReportSnapshot } from '../reports/domain/report-target-snapshot';
import {
  canonicalTextInput,
  MAX_ANALYSIS_CONTENT_LENGTH,
  MAX_ANALYSIS_TITLE_LENGTH,
} from './canonical-text-input';

const post: PostReportSnapshot = {
  version: 1,
  targetType: 'POST',
  postId: 'post',
  authorId: 'author',
  title: '  Title  ',
  content: '  Cafe\u0301\r\nbody  ',
  status: 'PUBLISHED',
  visibility: 'PUBLIC',
  gameId: null,
  type: null,
  categoryId: null,
  media: [],
};

describe('canonical text input v1', () => {
  it('projects only bounded POST text with deterministic normalization', () => {
    expect(canonicalTextInput(post)).toMatchObject({
      inputSchemaVersion: 1,
      inputSnapshot: { type: 'POST', title: 'Title', content: 'Café\nbody' },
    });
    expect(canonicalTextInput({ ...post, title: '  ' }).inputSnapshot).toEqual({
      type: 'POST',
      title: null,
      content: 'Café\nbody',
    });
  });

  it('uses a documented UTF-8 JSON fingerprint and ignores non-input evidence', () => {
    const serialized =
      '{"inputSchemaVersion":1,"input":{"type":"POST","title":"Title","content":"Café\\nbody"}}';
    const hash = `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
    expect(canonicalTextInput(post).snapshotHash).toBe(hash);
    expect(
      canonicalTextInput({
        ...post,
        content: 'Café\nbody',
        authorId: 'other',
        status: 'HIDDEN',
      }).snapshotHash,
    ).toBe(hash);
    expect(
      canonicalTextInput({ ...post, content: 'Changed' }).snapshotHash,
    ).not.toBe(hash);
  });

  it('projects COMMENT text without parent identity or context', () => {
    const result = canonicalTextInput({
      version: 1,
      targetType: 'COMMENT',
      commentId: 'c',
      authorId: 'u',
      content: '  Comment\rbody  ',
      status: 'PUBLISHED',
      postId: 'p',
      parentId: 'parent',
      gameId: 'g',
    });
    expect(result.inputSnapshot).toEqual({
      type: 'COMMENT',
      content: 'Comment\nbody',
    });
  });

  it('bounds Unicode code points without splitting emoji; suffix edits outside the analyzed prefix dedupe', () => {
    const input = {
      ...post,
      title: '😀'.repeat(MAX_ANALYSIS_TITLE_LENGTH + 1),
      content: '😀'.repeat(MAX_ANALYSIS_CONTENT_LENGTH + 1),
    };
    const result = canonicalTextInput(input);
    expect(Array.from(result.inputSnapshot.content)).toHaveLength(
      MAX_ANALYSIS_CONTENT_LENGTH,
    );
    expect(result.inputSnapshot).toHaveProperty(
      'title',
      '😀'.repeat(MAX_ANALYSIS_TITLE_LENGTH),
    );
    expect(result.snapshotHash).toBe(
      canonicalTextInput({ ...input, content: input.content + 'suffix' })
        .snapshotHash,
    );
  });
});
