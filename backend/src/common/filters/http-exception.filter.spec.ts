import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { MembershipChangePendingException } from '../exceptions/membership-change-pending.exception';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const discordLogger = { sendError: jest.fn() };
  const response = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/chat/x?token=secret', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;

  let filter: HttpExceptionFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    response.status.mockReturnThis();
    filter = new HttpExceptionFilter(discordLogger as never);
  });

  const sentBody = () =>
    (response.json.mock.calls[0] as [Record<string, unknown>])[0];

  it('passes through the machine-readable code of an exception that carries one', () => {
    filter.catch(new MembershipChangePendingException(), host);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(sentBody()).toMatchObject({
      statusCode: 409,
      code: 'MEMBERSHIP_CHANGE_PENDING',
    });
  });

  it('leaves the code out for an ordinary exception', () => {
    filter.catch(new BadRequestException('nope'), host);

    expect(sentBody()).not.toHaveProperty('code');
    expect(sentBody()).toMatchObject({ message: 'nope' });
  });

  it('ignores a code that is not a string', () => {
    filter.catch(new BadRequestException({ message: 'nope', code: 42 }), host);

    expect(sentBody()).not.toHaveProperty('code');
  });
});
