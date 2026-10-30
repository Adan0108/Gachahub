import {
  ModerationAnalysisInputService,
  MAX_INPUT_RESPONSE_BYTES,
} from './moderation-analysis-input.service';
import { hashTextInput } from './canonical-text-input';
import type { PrismaService } from '../prisma/prisma.service';

function fixture() {
  const input = {
    type: 'POST' as const,
    title: null,
    content: 'immutable fixture',
  };
  return {
    id: 'job',
    caseId: 'case',
    generation: 1,
    targetType: 'POST',
    targetId: 'post',
    inputSchemaVersion: 1,
    inputSnapshot: input,
    snapshotHash: hashTextInput(input),
    classifierProfile: 'moderation-text-v1',
  };
}
describe('immutable moderation input API service', () => {
  const findUnique = jest.fn();
  const service = new ModerationAnalysisInputService({
    moderationAnalysis: { findUnique },
  } as unknown as PrismaService);
  beforeEach(() => findUnique.mockReset());
  it.each([20000, 20001, 30000, 30001])(
    'validates schema-1 content boundary %i',
    async (length) => {
      const input = { ...fixture().inputSnapshot, content: 'x'.repeat(length) };
      findUnique.mockResolvedValue({
        ...fixture(),
        inputSnapshot: input,
        snapshotHash: hashTextInput(input),
      });
      if (length > 30000)
        await expect(service.getInput('job')).rejects.toMatchObject({
          status: 500,
        });
      else
        await expect(service.getInput('job')).resolves.toMatchObject({
          inputSchemaVersion: 1,
          input,
        });
    },
  );
  it('returns only stored immutable text and bounded job identity', async () => {
    findUnique.mockResolvedValue(fixture());
    const response = await service.getInput('job');
    expect(response).toEqual({
      ...fixture(),
      analysisJobId: 'job',
      id: undefined,
      inputSnapshot: undefined,
      input: fixture().inputSnapshot,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'job' },
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
    });
    expect(JSON.stringify(response)).not.toMatch(
      /reporter|email|author|sourceReport|details/,
    );
  });
  it('returns 404 for a deleted or unknown analysis', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.getInput('missing')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('serves the new model profile while retaining the original fixture profile', async () => {
    findUnique.mockResolvedValue({
      ...fixture(),
      classifierProfile: 'toxicity-mmbert-small-v1',
    });
    await expect(service.getInput('job')).resolves.toMatchObject({
      classifierProfile: 'toxicity-mmbert-small-v1',
    });
  });
  it.each([
    { inputSnapshot: {} },
    { inputSchemaVersion: 2 },
    { classifierProfile: 'future' },
    { snapshotHash: `sha256:${'a'.repeat(64)}` },
    { targetType: 'COMMENT' },
    {
      inputSnapshot: { ...fixture().inputSnapshot, content: 'x'.repeat(30001) },
    },
    { inputSnapshot: { ...fixture().inputSnapshot, title: '' } },
    { inputSnapshot: { ...fixture().inputSnapshot, reporterId: 'private' } },
    { inputSnapshot: { ...fixture().inputSnapshot, content: 'bad\0text' } },
  ])('fails closed on corrupt/unsupported stored input %#', async (patch) => {
    findUnique.mockResolvedValue({ ...fixture(), ...patch });
    await expect(service.getInput('job')).rejects.toMatchObject({
      status: 500,
    });
  });
  it('bounds worst-case escaping and preserves full-prefix trailing whitespace', async () => {
    const input = {
      type: 'POST' as const,
      title: 'a'.repeat(299) + ' ',
      content: '\u0001'.repeat(30000),
    };
    findUnique.mockResolvedValue({
      ...fixture(),
      inputSnapshot: input,
      snapshotHash: hashTextInput(input),
    });
    const response = await service.getInput('job');
    expect(response.input).toEqual(input);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(
      MAX_INPUT_RESPONSE_BYTES,
    );
    findUnique.mockResolvedValue({
      ...fixture(),
      targetId: 'a'.repeat(MAX_INPUT_RESPONSE_BYTES),
    });
    await expect(service.getInput('job')).rejects.toMatchObject({
      status: 500,
    });
  });
  it('sanitizes persistence failures', async () => {
    findUnique.mockRejectedValue(new Error('sensitive database arguments'));
    await expect(service.getInput('job')).rejects.toThrow(
      'Moderation input retrieval failed',
    );
  });
});
