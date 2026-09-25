jest.mock('../auth/auth', () => ({ auth: {} }));

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));

import { HandshakesSinceQueryDto } from './dto/handshakes-since-query.dto';
import { RosterQueryDto } from './dto/roster-query.dto';
import { DeviceQueryDto } from './dto/device-query.dto';
import { MembershipWorkQueryDto } from './dto/membership-work-query.dto';
import { PendingWelcomesQueryDto } from './dto/pending-welcomes-query.dto';
import 'reflect-metadata';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { MlsHandshakesController } from './mls-handshakes.controller';
import { SubmitHandshakeDto } from './dto/submit-handshake.dto';
import { ExternalJoinDto } from './dto/external-join.dto';
import { ReportCommitFaultDto } from './dto/report-commit-fault.dto';

const session = {
  user: { id: 'user-1' },
  session: { id: 'session-1' },
} as unknown as UserSession;

function paramTypes(method: keyof MlsHandshakesController): unknown[] {
  return Reflect.getMetadata(
    'design:paramtypes',
    MlsHandshakesController.prototype,
    method,
  ) as unknown[];
}

describe('MlsHandshakesController', () => {
  const handshakes = {
    submitHandshake: jest.fn(),
    submitExternalJoin: jest.fn(),
    getHandshakesSince: jest.fn(),
    getRosterAtEpoch: jest.fn(),
    getPendingWelcomes: jest.fn(),
    consumeWelcome: jest.fn(),
  };
  const membershipWork = {
    getMembershipWork: jest.fn(),
    releaseMembershipWork: jest.fn(),
  };
  const faults = { reportFault: jest.fn() };
  const selfJoin = { getGroupInfo: jest.fn(), listJoinable: jest.fn() };
  const pending = { getPendingSummary: jest.fn() };
  let controller: MlsHandshakesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MlsHandshakesController(
      handshakes as any,
      membershipWork as any,
      faults as any,
      selfJoin as any,
      pending as any,
    );
  });

  it('binds request bodies to their validated DTO classes', () => {
    expect(paramTypes('submitHandshake')[2]).toBe(SubmitHandshakeDto);
    expect(paramTypes('submitExternalJoin')[2]).toBe(ExternalJoinDto);
    expect(paramTypes('reportCommitFault')[2]).toBe(ReportCommitFaultDto);
  });

  it('validates every query string through a DTO, so repeated params cannot reach Prisma', () => {
    expect(paramTypes('getHandshakesSince')[2]).toBe(HandshakesSinceQueryDto);
    expect(paramTypes('getRosterAtEpoch')[2]).toBe(RosterQueryDto);
    expect(paramTypes('getGroupInfo')[2]).toBe(DeviceQueryDto);
    expect(paramTypes('getMembershipWork')[2]).toBe(MembershipWorkQueryDto);
    expect(paramTypes('getPendingWelcomes')[2]).toBe(PendingWelcomesQueryDto);
  });

  it('submits a commit as the session user', () => {
    const dto = { deviceId: 'd1' } as SubmitHandshakeDto;

    controller.submitHandshake(session, 'conv-1', dto);

    expect(handshakes.submitHandshake).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      dto,
    );
  });

  it('submits an external join as the session user', () => {
    const dto = { deviceId: 'd1' } as ExternalJoinDto;

    controller.submitExternalJoin(session, 'conv-1', dto);

    expect(handshakes.submitExternalJoin).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      dto,
    );
  });

  it('fetches the group info for the queried device', () => {
    controller.getGroupInfo(session, 'conv-1', { deviceId: 'd1' });

    expect(selfJoin.getGroupInfo).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      'd1',
    );
  });

  it('lists joinable conversations, defaulting to the cheap scope', () => {
    controller.listJoinable(session, 'd1', {});
    controller.listJoinable(session, 'd1', { scope: 'pending' });
    controller.listJoinable(session, 'd1', { scope: 'full' });

    expect(
      (selfJoin.listJoinable.mock.calls as unknown[][]).map((call) => call[2]),
    ).toEqual(['pending', 'pending', 'full']);
  });

  it('reports a commit fault as the session user', () => {
    const dto = { epoch: 1 } as ReportCommitFaultDto;

    controller.reportCommitFault(session, 'conv-1', dto);

    expect(faults.reportFault).toHaveBeenCalledWith('user-1', 'conv-1', dto);
  });

  it('fetches commits since an epoch', () => {
    controller.getHandshakesSince(session, 'conv-1', { sinceEpoch: 4 });

    expect(handshakes.getHandshakesSince).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      4,
    );
  });

  it('fetches the roster at an epoch', () => {
    controller.getRosterAtEpoch(session, 'conv-1', { epoch: 7 });

    expect(handshakes.getRosterAtEpoch).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
      7,
    );
  });

  it('summarizes what a device has waiting', () => {
    controller.getPendingSummary(session, 'd1');

    expect(pending.getPendingSummary).toHaveBeenCalledWith('user-1', 'd1');
  });

  it('fetches and consumes welcomes for the given device', () => {
    controller.getPendingWelcomes(session, 'd1', { after: 'w0' });
    controller.consumeWelcome(session, 'd1', 'w1');

    expect(handshakes.getPendingWelcomes).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'w0',
    );
    expect(handshakes.consumeWelcome).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'w1',
    );
  });

  it('takes membership work with the full scope only when asked', () => {
    controller.getMembershipWork(session, 'd1', {});
    controller.getMembershipWork(session, 'd1', {
      scope: 'full',
      after: 'conv-0',
      conversationId: 'conv-9',
    });

    expect(membershipWork.getMembershipWork).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'd1',
      { scope: 'pending', after: undefined, conversationId: undefined },
    );
    expect(membershipWork.getMembershipWork).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'd1',
      { scope: 'full', after: 'conv-0', conversationId: 'conv-9' },
    );
  });

  it('releases a membership work lease', () => {
    controller.releaseMembershipWork(session, 'd1', 'conv-1');

    expect(membershipWork.releaseMembershipWork).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'conv-1',
    );
  });
});
