import { BlockList, isIP } from 'node:net';

const IPV4_RESERVED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
];

const IPV6_RESERVED: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback and the deprecated IPv4-compatible range
  ['::ffff:0:0', 96], // IPv4-mapped: would reach an IPv4 address this list never saw
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
];

// One list per family: BlockList also checks an IPv4 address against the IPv6 rules as if it were IPv4-mapped.
const reserved4 = new BlockList();
const reserved6 = new BlockList();
for (const [network, prefix] of IPV4_RESERVED)
  reserved4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6_RESERVED)
  reserved6.addSubnet(network, prefix, 'ipv6');

/** True only for an IP literal on the public internet; anything unparseable, scoped or reserved is false. */
export function isPublicAddress(address: string): boolean {
  if (address.includes('%')) return false;

  const family = isIP(address);
  if (family === 4) return !reserved4.check(address, 'ipv4');
  if (family === 6) return !reserved6.check(address, 'ipv6');
  return false;
}
