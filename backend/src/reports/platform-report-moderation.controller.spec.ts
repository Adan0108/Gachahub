jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));
jest.mock('./report-moderation.service', () => ({
  ReportModerationService: class {},
}));
jest.mock('../common/guards/platform-moderator.guard', () => ({
  PlatformModeratorGuard: class {},
}));
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { PlatformModeratorGuard } from '../common/guards/platform-moderator.guard';
import { ReportModerationService } from './report-moderation.service';
import { PlatformReportModerationController } from './platform-report-moderation.controller';

describe('PlatformReportModerationController', () => {
  it('forwards authenticated ID and query unchanged', () => {
    const service = { listForPlatform: jest.fn().mockReturnValue('result') };
    const controller = new PlatformReportModerationController(
      service as unknown as ReportModerationService,
    );
    const query = { scope: 'platform' as const, page: 2 };
    expect(
      controller.list({ user: { id: 'actor' } } as UserSession, query),
    ).toBe('result');
    expect(service.listForPlatform).toHaveBeenCalledWith('actor', query);
  });
  it('requires PlatformModeratorGuard', () => {
    const guards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformReportModerationController,
    );
    expect(guards).toEqual([PlatformModeratorGuard]);
  });
});
