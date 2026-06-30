// src/lib/replicate/page-signature.ts
//
// A page's structural fingerprint, used to cluster pages that share a layout.
// signatureKey() ignores text/images — only the ordered section TYPES and the
// structural attrs that drive template choice contribute to the key.
//
//   page  ──▶ [ {type:'cover-with-headline'}, {type:'columns',columns:3}, {type:'cta'} ]
//                                    │
//                                    ▼  signatureKey()
//                    "cover-with-headline|columns:3|cta"
//
export type ImageBucket = 'none' | 'few' | 'many';

export interface SectionSignature {
  /** Interaction-model type, e.g. 'cover-with-headline', 'columns', 'gallery'. */
  type: string;
  /** Column count where it affects the template (columns / card grids). */
  columns?: number;
  /** Media side for media-text sections. */
  mediaPosition?: 'left' | 'right';
  /** Coarse image-count bucket (galleries vs single-image sections). */
  imageBucket?: ImageBucket;
}

export interface PageSignature {
  url: string;
  /** Rendered-HTML byte size — proxy for "richness" when picking a representative. */
  htmlBytes: number;
  sections: SectionSignature[];
}

/** Deterministic clustering key. Pages with an identical key share a cluster. */
export function signatureKey(sig: PageSignature): string {
  return sig.sections
    .map((s) => {
      const attrs = [
        s.columns != null ? `c${s.columns}` : '',
        s.mediaPosition ? `m${s.mediaPosition[0]}` : '',
        s.imageBucket ? `i${s.imageBucket[0]}` : '',
      ].filter(Boolean).join(',');
      return attrs ? `${s.type}{${attrs}}` : s.type;
    })
    .join('|');
}
