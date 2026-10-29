import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { CreateCommentDto } from '../comments/dto/create-comment.dto';
import { UpdatePostDto } from '../posts/dto/update-post.dto';
import {
  normalizeAnalysisText,
  MAX_ANALYSIS_CONTENT_LENGTH,
} from './canonical-text-input';

describe('existing moderation text boundaries (characterization only)', () => {
  it('rejects empty and whitespace comments after the DTO trim', () => {
    for (const content of ['', ' \r\n\t ']) {
      const dto = plainToInstance(CreateCommentDto, { content });
      expect(
        validateSync(dto).some((error) => error.property === 'content'),
      ).toBe(true);
    }
  });

  it('rejects blank POST content on create and update, while preserving optional updates', () => {
    for (const dtoClass of [CreatePostDto, UpdatePostDto]) {
      for (const content of ['', ' \r\n\t ', '\u00a0\ufeff']) {
        const dto = plainToInstance(dtoClass, { content });
        expect(
          validateSync(dto).some((error) => error.property === 'content'),
        ).toBe(true);
      }
      const valid = plainToInstance(dtoClass, { content: '  Cảm ơn 😀  ' });
      expect(valid.content).toBe('Cảm ơn 😀');
      expect(
        validateSync(valid).some((error) => error.property === 'content'),
      ).toBe(false);
    }
    expect(validateSync(plainToInstance(UpdatePostDto, {}))).toEqual([]);
  });

  it('keeps request bounds distinct from the canonical snapshot bound', () => {
    expect(
      validateSync(
        plainToInstance(CreateCommentDto, { content: 'a'.repeat(2001) }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateSync(
        plainToInstance(CreatePostDto, { content: 'a'.repeat(30001) }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      normalizeAnalysisText('😀'.repeat(30001), MAX_ANALYSIS_CONTENT_LENGTH),
    ).toBe('😀'.repeat(30000));
  });
  it.each([20000, 20001, 30000, 30001])(
    'matches POST product boundary at %i characters',
    (length) => {
      for (const dtoClass of [CreatePostDto, UpdatePostDto]) {
        const errors = validateSync(
          plainToInstance(dtoClass, { content: '😀'.repeat(length) }),
        );
        expect(errors.some((error) => error.property === 'content')).toBe(
          length > 30000,
        );
      }
      expect(
        validateSync(
          plainToInstance(CreateCommentDto, { content: '😀'.repeat(2000) }),
        ),
      ).toEqual([]);
      expect(
        validateSync(
          plainToInstance(CreateCommentDto, { content: '😀'.repeat(2001) }),
        ).length,
      ).toBeGreaterThan(0);
    },
  );
});
