import type { LookupAddress } from 'node:dns';
import { createSafeLookup, type Resolver } from './safe-lookup';
import { UnsafeUrlError } from './url-policy';

const v4 = (address: string): LookupAddress => ({ address, family: 4 });
const v6 = (address: string): LookupAddress => ({ address, family: 6 });

function run(
  resolver: Resolver,
  options: { all?: boolean } = {},
  hostname = 'example.com',
) {
  return new Promise<{
    error: Error | null;
    address: unknown;
    family: number | undefined;
  }>((resolve) => {
    createSafeLookup(resolver)(hostname, options, (error, address, family) =>
      resolve({ error, address, family }),
    );
  });
}

describe('createSafeLookup', () => {
  it('hands back the first public address', async () => {
    const result = await run(() =>
      Promise.resolve([v4('93.184.216.34'), v6('2606:2800::1')]),
    );

    expect(result).toEqual({
      error: null,
      address: '93.184.216.34',
      family: 4,
    });
  });

  it('hands back every address when asked for all', async () => {
    const answers = [v4('93.184.216.34'), v6('2606:2800::1')];

    const result = await run(() => Promise.resolve(answers), { all: true });

    expect(result.error).toBeNull();
    expect(result.address).toEqual(answers);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['private', '10.0.0.8'],
    ['cloud metadata', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
  ])('refuses a name that resolves to %s', async (_name, address) => {
    const result = await run(() => Promise.resolve([v4(address)]));

    expect(result.error).toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses the whole name when only one of its answers is internal', async () => {
    const result = await run(() =>
      Promise.resolve([v4('93.184.216.34'), v4('127.0.0.1')]),
    );

    expect(result.error).toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses a name that resolves to nothing', async () => {
    const result = await run(() => Promise.resolve([]));

    expect(result.error).toBeInstanceOf(UnsafeUrlError);
  });

  it('passes a resolver failure along', async () => {
    const failure = Object.assign(new Error('not found'), {
      code: 'ENOTFOUND',
    });

    const result = await run(() => Promise.reject(failure));

    expect(result.error).toBe(failure);
  });

  it('asks the resolver about the name it was given', async () => {
    const resolver = jest.fn<Promise<LookupAddress[]>, [string]>(() =>
      Promise.resolve([v4('93.184.216.34')]),
    );

    await run(resolver, {}, 'cdn.example.org');

    expect(resolver).toHaveBeenCalledWith('cdn.example.org');
  });
});
