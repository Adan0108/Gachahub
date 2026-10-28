jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));
jest.mock('../moderation/report-moderation.service', () => ({
  ReportModerationService: class {},
}));
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ReportModerationService } from '../moderation/report-moderation.service';
import { GameCaseModerationController } from './game-case-moderation.controller';

describe('GameCaseModerationController', () => {
  const service = {
    listCasesForGame: jest.fn(),
    getCaseForGame: jest.fn(),
    listCaseReportsForGame: jest.fn(),
    claimCaseForGame: jest.fn(),
    resolveCaseForGame: jest.fn(),
    dismissCaseForGame: jest.fn(),
  };
  const controller = new GameCaseModerationController(
    service as unknown as ReportModerationService,
  );
  const session = { user: { id: 'actor' } } as UserSession;
  beforeEach(() => jest.resetAllMocks());
  it('forwards exact scope, user, case IDs and validated queries', async () => {
    const query = { status: 'OPEN' as const };
    const evidence = { limit: 5 };
    const dto = { resolutionNote: 'Done' };
    await controller.list('slug', session, query);
    await controller.detail('slug', 'case', session);
    await controller.reports('slug', 'case', session, evidence);
    await controller.claim('slug', 'case', session);
    await controller.resolve('slug', 'case', session, dto);
    await controller.dismiss('slug', 'case', session, dto);
    expect(service.listCasesForGame).toHaveBeenCalledWith(
      'slug',
      'actor',
      query,
    );
    expect(service.getCaseForGame).toHaveBeenCalledWith(
      'slug',
      'actor',
      'case',
    );
    expect(service.listCaseReportsForGame).toHaveBeenCalledWith(
      'slug',
      'actor',
      'case',
      evidence,
    );
    expect(service.claimCaseForGame).toHaveBeenCalledWith(
      'slug',
      'actor',
      'case',
    );
    expect(service.resolveCaseForGame).toHaveBeenCalledWith(
      'slug',
      'actor',
      'case',
      dto,
    );
    expect(service.dismissCaseForGame).toHaveBeenCalledWith(
      'slug',
      'actor',
      'case',
      dto,
    );
  });
  it('registers only native game-scoped case routes', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GameCaseModerationController,
      ) as unknown,
    ).toBe('games/:gameSlug/moderation/cases');
    for (const [name, path, verb] of [
      ['list', '/', RequestMethod.GET],
      ['detail', ':caseId', RequestMethod.GET],
      ['reports', ':caseId/reports', RequestMethod.GET],
      ['claim', ':caseId/claim', RequestMethod.PATCH],
      ['resolve', ':caseId/resolve', RequestMethod.PATCH],
      ['dismiss', ':caseId/dismiss', RequestMethod.PATCH],
    ] as const) {
      const method = Object.getOwnPropertyDescriptor(
        GameCaseModerationController.prototype,
        name,
      )!.value as object;
      expect(Reflect.getMetadata(PATH_METADATA, method) as unknown).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method) as unknown).toBe(
        verb,
      );
    }
  });
});
