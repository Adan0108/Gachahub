jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));
jest.mock('../moderation/report-moderation.service', () => ({
  ReportModerationService: class {},
}));
jest.mock('../../common/guards/platform-moderator.guard', () => ({
  PlatformModeratorGuard: class {},
}));
import {
  GUARDS_METADATA,
  PATH_METADATA,
  METHOD_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PlatformModeratorGuard } from '../../common/guards/platform-moderator.guard';
import { ReportModerationService } from '../moderation/report-moderation.service';
import { PlatformCaseModerationController } from './platform-case-moderation.controller';

describe('PlatformCaseModerationController', () => {
  const service = {
    listCasesForPlatform: jest.fn(),
    getCaseForPlatform: jest.fn(),
    listCaseReportsForPlatform: jest.fn(),
  };
  const controller = new PlatformCaseModerationController(
    service as unknown as ReportModerationService,
  );
  const session = { user: { id: 'actor' } } as UserSession;
  beforeEach(() => jest.resetAllMocks());
  it('delegates native list query and authenticated ID', () => {
    const query = { scope: 'platform' as const, status: 'OPEN' as const };
    service.listCasesForPlatform.mockReturnValue('result');
    expect(controller.list(session, query)).toBe('result');
    expect(service.listCasesForPlatform).toHaveBeenCalledWith('actor', query);
  });
  it('delegates exact case ID for detail', async () => {
    await controller.detail(session, 'case');
    expect(service.getCaseForPlatform).toHaveBeenCalledWith('actor', 'case');
  });
  it('delegates evidence query and case ID', async () => {
    const query = { cursor: 'opaque', limit: 10 };
    await controller.reports(session, 'case', query);
    expect(service.listCaseReportsForPlatform).toHaveBeenCalledWith(
      'actor',
      'case',
      query,
    );
  });
  it('applies platform guard and only GET case routes', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        PlatformCaseModerationController,
      ) as unknown,
    ).toEqual([PlatformModeratorGuard]);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        PlatformCaseModerationController,
      ) as unknown,
    ).toBe('moderation/cases');
    for (const [name, path] of [
      ['list', '/'],
      ['detail', ':caseId'],
      ['reports', ':caseId/reports'],
    ] as const) {
      const method = Object.getOwnPropertyDescriptor(
        PlatformCaseModerationController.prototype,
        name,
      )!.value as object;
      expect(Reflect.getMetadata(PATH_METADATA, method) as unknown).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method) as unknown).toBe(
        RequestMethod.GET,
      );
    }
  });
});
