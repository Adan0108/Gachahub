jest.mock('../auth/auth', () => ({ auth: {} }));

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Session: () => () => undefined,
}));

import 'reflect-metadata';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ChatDevicesController } from './chat-devices.controller';
import { ClaimKeyPackagesQueryDto } from './dto/claim-key-packages-query.dto';
import { LinkSessionDto } from './dto/link-session.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UploadKeyPackagesDto } from './dto/upload-key-packages.dto';

const session = {
  user: { id: 'user-1' },
  session: { id: 'session-1' },
} as unknown as UserSession;

function paramTypes(method: keyof ChatDevicesController): unknown[] {
  return Reflect.getMetadata(
    'design:paramtypes',
    ChatDevicesController.prototype,
    method,
  ) as unknown[];
}

describe('ChatDevicesController', () => {
  const service = {
    registerDevice: jest.fn(),
    uploadKeyPackages: jest.fn(),
    getKeyPackageStatus: jest.fn(),
    issueSessionLinkChallenge: jest.fn(),
    linkSessionToDevice: jest.fn(),
    signOutDevice: jest.fn(),
    revokeDevice: jest.fn(),
    claimKeyPackagesForUser: jest.fn(),
  };
  let controller: ChatDevicesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ChatDevicesController(service as any);
  });

  it('binds request bodies and queries to their validated DTO classes', () => {
    expect(paramTypes('registerDevice')[1]).toBe(RegisterDeviceDto);
    expect(paramTypes('uploadKeyPackages')[2]).toBe(UploadKeyPackagesDto);
    expect(paramTypes('linkSession')[2]).toBe(LinkSessionDto);
    expect(paramTypes('claimKeyPackages')[2]).toBe(ClaimKeyPackagesQueryDto);
  });

  it('registers a device for the session user', () => {
    const dto = { id: 'd1' } as unknown as RegisterDeviceDto;

    controller.registerDevice(session, dto);

    expect(service.registerDevice).toHaveBeenCalledWith('user-1', dto);
  });

  it('uploads key packages and reads status for an owned device', () => {
    const dto = { keyPackages: [] } as unknown as UploadKeyPackagesDto;

    controller.uploadKeyPackages(session, 'd1', dto);
    controller.keyPackageStatus(session, 'd1');

    expect(service.uploadKeyPackages).toHaveBeenCalledWith('user-1', 'd1', dto);
    expect(service.getKeyPackageStatus).toHaveBeenCalledWith('user-1', 'd1');
  });

  it('issues a challenge and links the session to the device', () => {
    const dto = { signature: 'sig' } as unknown as LinkSessionDto;

    controller.sessionLinkChallenge(session, 'd1');
    controller.linkSession(session, 'd1', dto);

    expect(service.issueSessionLinkChallenge).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'session-1',
    );
    expect(service.linkSessionToDevice).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'session-1',
      dto,
    );
  });

  it('passes the current session id when signing out or revoking', () => {
    controller.signOutDevice(session, 'd1');
    controller.revokeDevice(session, 'd1');

    expect(service.signOutDevice).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'session-1',
    );
    expect(service.revokeDevice).toHaveBeenCalledWith(
      'user-1',
      'd1',
      'session-1',
    );
  });

  it('claims key packages of another user as the session user', () => {
    const query = { deviceIds: ['d2'] } as ClaimKeyPackagesQueryDto;

    controller.claimKeyPackages(session, 'user-2', query);

    expect(service.claimKeyPackagesForUser).toHaveBeenCalledWith(
      'user-1',
      'user-2',
      query,
    );
  });
});
