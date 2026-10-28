import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDestinationError';
  }
}

const V4_BLOCKS: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKS.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return n >= v4ToInt(base) && n < v4ToInt(base) + size;
  });
}

/** Expands any IPv6 text form to eight 16-bit groups (handles `::` and a trailing dotted IPv4). */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted?.[1]) {
    const n = v4ToInt(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True only for globally routable unicast addresses. Anything unparsable is rejected. */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip.includes('%') ? ip.slice(0, ip.indexOf('%')) : ip);
  if (family === 4) return isPublicV4(ip);
  if (family !== 6) return false;
  const g = expandV6(ip);
  if (!g) return false;
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  const embeddedV4 = `${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPublicV4(embeddedV4); // ::ffff:a.b.c.d
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return false; // ::, ::1, IPv4-compatible
  if (a === 0x64 && b === 0xff9b) return isPublicV4(embeddedV4); // 64:ff9b::/96 NAT64
  if ((a & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x2002) return isPublicV4(`${b >> 8}.${b & 255}.${c >> 8}.${c & 255}`); // 6to4
  return (a & 0xe000) === 0x2000; // only 2000::/3 is global unicast today
}

export type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>;
export const defaultLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Resolves the host and requires EVERY answer to be public (one private answer is enough to refuse: mixed answers
 * are a classic rebinding trick). Returns the address to connect to, so the request can be pinned to the IP that
 * was checked instead of resolving again.
 */
export async function resolvePublicAddress(hostname: string, lookup: LookupAll = defaultLookup): Promise<{ address: string; family: 4 | 6 }> {
  if (isIP(hostname) !== 0) {
    if (!isPublicIp(hostname)) throw new UnsafeDestinationError('Destination address is not public');
    return { address: hostname, family: isIP(hostname) === 4 ? 4 : 6 };
  }
  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(hostname);
  } catch {
    throw new UnsafeDestinationError('Destination host did not resolve');
  }
  const first = answers[0];
  if (!first) throw new UnsafeDestinationError('Destination host did not resolve');
  if (!answers.every((a) => isPublicIp(a.address))) throw new UnsafeDestinationError('Destination resolves to a non-public address');
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}
