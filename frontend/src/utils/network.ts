export type SortDirection = 'asc' | 'desc';

/**
 * Parses a dotted IPv4 address string into an unsigned 32-bit integer,
 * or returns null if the string is not a valid IPv4 address.
 */
export function ipv4ToNumber(value: string): number | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

/**
 * Formats an unsigned 32-bit integer as a dotted IPv4 address string.
 */
export function numberToIPv4(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}
