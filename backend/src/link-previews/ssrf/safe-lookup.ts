import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isPublicAddress } from './ip-policy';
import { UnsafeUrlError } from './url-policy';

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type SafeLookup = (
  hostname: string,
  options: { all?: boolean },
  callback: LookupCallback,
) => void;

const resolveAll: Resolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/** A lookup for the connection itself, so the checked address is the one connected to; one non-public answer refuses the name. */
export function createSafeLookup(resolve: Resolver = resolveAll): SafeLookup {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (
          addresses.length === 0 ||
          addresses.some(({ address }) => !isPublicAddress(address))
        ) {
          callback(new UnsafeUrlError('Non-public address'), '');
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ''),
    );
  };
}
