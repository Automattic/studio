// src/lib/replicate/cluster-pages.ts
//
// Exact-signature clustering. Pages with an identical signatureKey() join one
// cluster; the representative is the member with the most rendered-HTML bytes
// (proxy for "most sections"). Fuzzy/near-miss merge is intentionally out of
// scope.
//
//   signatures ──▶ group by signatureKey ──▶ per group pick max(htmlBytes) as rep
//
import { signatureKey, type PageSignature } from './page-signature.js';

export interface Cluster {
  key: string;
  members: string[];
  representative: string;
  signature: PageSignature;
}

export interface ClusterResult {
  clusters: Cluster[];
}

export function clusterPages(signatures: PageSignature[]): ClusterResult {
  const groups = new Map<string, PageSignature[]>();
  for (const sig of signatures) {
    const key = signatureKey(sig);
    const group = groups.get(key);
    if (group) group.push(sig);
    else groups.set(key, [sig]);
  }

  const clusters: Cluster[] = [];
  for (const [key, group] of groups) {
    const rep = group.reduce((best, s) => (s.htmlBytes > best.htmlBytes ? s : best));
    clusters.push({
      key,
      members: group.map((s) => s.url),
      representative: rep.url,
      signature: rep,
    });
  }
  return { clusters };
}
