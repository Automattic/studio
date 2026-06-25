// src/lib/screenshot/first-party.ts
//
// First-party = same registrable domain (eTLD+1) as the base URL — so the
// owner's own subdomains (assets.X, cdn.X) count as first-party, but real
// third parties (jsdelivr, google-analytics) do not.
//
// NOTE: uses a small built-in multi-part-TLD list rather than the full public
// suffix list. Covers common cases; extend MULTI_PART_TLDS if needed.

const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'com.au', 'com.br', 'co.nz',
  'co.za', 'com.mx', 'co.in', 'com.sg',
]);

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export function isFirstParty(url: string, baseUrl: string): boolean {
  let u: URL, b: URL;
  try { b = new URL(baseUrl); } catch { return false; }
  try { u = new URL(url, baseUrl); } catch { return false; }
  return registrableDomain(u.hostname) === registrableDomain(b.hostname);
}
