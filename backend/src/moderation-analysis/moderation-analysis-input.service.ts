import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashTextInput,
  MAX_ANALYSIS_CONTENT_LENGTH,
  MAX_ANALYSIS_TITLE_LENGTH,
  normalizeAnalysisText,
  TEXT_CLASSIFIER_PROFILE,
  TEXT_INPUT_SCHEMA_VERSION,
} from './canonical-text-input';
import type { ModerationAnalysisInputResponse } from './moderation-analysis-input.types';

function boundedText(limit: number) {
  return z
    .string()
    .max(limit * 2)
    .refine(
      (text) =>
        !text.includes('\0') &&
        !/\p{Surrogate}/u.test(text) &&
        Array.from(text).length <= limit &&
        (normalizeAnalysisText(text, limit) === text ||
          (Array.from(text).length === limit &&
            normalizeAnalysisText(text, limit) === text.trimEnd())),
    );
}
const content = boundedText(MAX_ANALYSIS_CONTENT_LENGTH);
const snapshotSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('POST'),
    title: boundedText(MAX_ANALYSIS_TITLE_LENGTH).min(1).nullable(),
    content,
  }),
  z.strictObject({ type: z.literal('COMMENT'), content }),
]);
export const MAX_INPUT_RESPONSE_BYTES = 256 * 1024;

@Injectable()
export class ModerationAnalysisInputService {
  constructor(private readonly prisma: PrismaService) {}

  async getInput(
    analysisJobId: string,
  ): Promise<ModerationAnalysisInputResponse> {
    const analysis = await this.prisma.moderationAnalysis
      .findUnique({
        where: { id: analysisJobId },
        select: {
          id: true,
          caseId: true,
          generation: true,
          targetType: true,
          targetId: true,
          inputSchemaVersion: true,
          inputSnapshot: true,
          snapshotHash: true,
          classifierProfile: true,
        },
      })
      .catch(() => {
        throw new InternalServerErrorException(
          'Moderation input retrieval failed',
        );
      });
    if (!analysis) throw new NotFoundException('Moderation analysis not found');
    // Never return parser errors or stored JSON through logs/errors.
    const parsed = snapshotSchema.safeParse(analysis.inputSnapshot);
    if (
      !parsed.success ||
      analysis.inputSchemaVersion !== TEXT_INPUT_SCHEMA_VERSION ||
      analysis.classifierProfile !== TEXT_CLASSIFIER_PROFILE ||
      parsed.data.type !== analysis.targetType ||
      hashTextInput(parsed.data) !== analysis.snapshotHash
    ) {
      throw new InternalServerErrorException(
        'Stored moderation input is invalid or unsupported',
      );
    }
    const response = {
      analysisJobId: analysis.id,
      caseId: analysis.caseId,
      generation: analysis.generation,
      targetType: analysis.targetType,
      targetId: analysis.targetId,
      inputSchemaVersion: analysis.inputSchemaVersion,
      snapshotHash: analysis.snapshotHash,
      classifierProfile: analysis.classifierProfile,
      input: parsed.data,
    };
    if (
      Buffer.byteLength(JSON.stringify(response), 'utf8') >
      MAX_INPUT_RESPONSE_BYTES
    ) {
      throw new InternalServerErrorException(
        'Stored moderation input exceeds response limit',
      );
    }
    return response;
  }
}
