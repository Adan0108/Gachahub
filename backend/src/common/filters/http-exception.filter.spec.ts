import {
  BadRequestException,
  HttpException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
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
  let logged: jest.SpyInstance;
  const originalEnvironment = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnvironment;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    response.status.mockReturnThis();
    filter = new HttpExceptionFilter(discordLogger as never);
    logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  const sentBody = () =>
    (response.json.mock.calls[0] as [Record<string, unknown>])[0];

  it.each(['production', 'test', undefined])(
    'redacts unexpected 500 diagnostics in %s but retains reporting details',
    (environment) => {
      if (environment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = environment;
      filter.catch(
        new Error('SQL SELECT secret FROM /server/private.ts'),
        host,
      );
      expect(sentBody().message).toBe(
        'Something went wrong. Please try again.',
      );
      expect(JSON.stringify(sentBody())).not.toContain('SELECT');
      const [reported] = discordLogger.sendError.mock.calls[0] as [
        {
          fields: Array<{ name: string; value: string; inline: boolean }>;
          stack: string;
        },
      ];
      expect(reported.fields).toContainEqual({
        name: 'Message',
        value: 'SQL SELECT secret FROM /server/private.ts',
        inline: false,
      });
      expect(reported.stack).toContain('SQL SELECT secret');
      expect(logged).toHaveBeenCalled();
    },
  );
  it('retains useful development diagnostics', () => {
    process.env.NODE_ENV = 'development';
    filter.catch(new Error('Database diagnostic'), host);
    expect(sentBody().message).toBe('Database diagnostic');
  });
  it('redacts explicit internal 5xx messages and codes while preserving safe validation errors', () => {
    process.env.NODE_ENV = 'production';
    filter.catch(
      new HttpException({ message: 'SQL internal', code: 'RAW_SQL' }, 503),
      host,
    );
    expect(sentBody()).toMatchObject({
      statusCode: 503,
      message: 'Something went wrong. Please try again.',
    });
    expect(sentBody()).not.toHaveProperty('code');
    response.json.mockClear();
    filter.catch(
      new BadRequestException({ message: ['Choose a reason'] }),
      host,
    );
    expect(sentBody().message).toEqual(['Choose a reason']);
  });

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
