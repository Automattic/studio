// src/lib/replicate/local-data/types.ts
//
// Data model for the "JS data-mount -> WordPress-driven data" path: a local
// site's JS-rendered card grids (an empty <div id="newestGrid"> filled at
// runtime by mountGrid(...)) become a real CPT + taxonomy + query loops, while
// the styling/animation/interaction JS is kept. The agent skill `model-local-data`
// produces a DataModel (from the source JS + author schema hints); the
// deterministic src consumes it to install the CPT, insert posts, and emit
// class-faithful core/query loops in place of the mounts.

/** Coarse meta-value type for sanitization + REST registration. */
export type DataFieldType = 'string' | 'integer' | 'number' | 'boolean';

/** Sub-type of a string field, driving the sanitize callback. */
export type DataFieldFormat = 'email' | 'url' | 'textarea' | 'date';

/** A custom-field definition on the CPT (stored as post meta). */
export interface DataField {
  /** Meta key, e.g. 'price_eur'. */
  key: string;
  /** Coarse type for sanitization + REST registration. */
  type: DataFieldType;
  /** Optional string sub-format → a stricter sanitize callback (email/url/etc.). */
  format?: DataFieldFormat;
  /** Optional human label (admin/REST); defaults to a title-cased key. */
  label?: string;
  /** Whether the field is required (advisory; surfaced by the validator). */
  required?: boolean;
}

/** A taxonomy bound to the CPT. */
export interface DataTaxonomy {
  /** Taxonomy slug, e.g. 'objet_cat'. */
  slug: string;
  /** Human label, e.g. 'Categories'. */
  label: string;
  /** Whether terms are hierarchical (category-like) vs flat (tag-like). */
  hierarchical: boolean;
  /** The full term set (slug + label), e.g. {slug:'glass',label:'Glass'}. */
  terms: Array<{ slug: string; label: string }>;
}

/** One gallery image for an item. The mockup uses caption-only placeholder
 * tiles (no real files); url is optional until real attachments are supplied. */
export interface DataGalleryImage {
  caption: string;
  url?: string;
}

/** A single content item -> one CPT post. */
export interface DataItem {
  /** Stable source id (e.g. 'opaline-vase-1965') -> meta._dla_item_id, the
   * idempotency key for update-in-place inserts. */
  id: string;
  /** post_title. */
  title: string;
  /** Term slugs assigned in the CPT's taxonomy. */
  terms: string[];
  /** Field key -> value (meta). Values are coerced per the field type on insert. */
  meta: Record<string, string | number | boolean>;
  /** Gallery images (placeholder captions and/or real urls). */
  gallery: DataGalleryImage[];
  /** Optional long body -> post_content (e.g. the 'story' field may double as content). */
  content?: string;
  /** Render-only: this post's permalink, populated per-post at render time
   * (PHP get_permalink). Lets a card link to its own post instead of the
   * source mockup's static detail href. */
  permalink?: string;
  /** Render-only: the first term's archive URL (PHP get_term_link). */
  catUrl?: string;
}

/** The CPT definition. */
export interface DataCpt {
  /** Post-type slug, e.g. 'objet'. */
  slug: string;
  /** Singular + plural labels. */
  singular: string;
  plural: string;
  /** Whether the type is publicly queryable / has archives. */
  public: boolean;
  /** Editor supports (title/editor/thumbnail/custom-fields …). */
  supports: string[];
}

/** Maps a source JS data-mount to the query that should replace it. */
export interface MountSpec {
  /** The mount element selector / id in the source, e.g. '#newestGrid'. */
  selector: string;
  /** The source JS expression that filled it (recorded for neutralization +
   * provenance), e.g. "mountGrid('#newestGrid', newestObjets(4))". */
  sourceCall: string;
  /** Query parameters for the replacement core/query loop. */
  query: {
    postType: string;
    /** -1 = all. */
    perPage: number;
    /** Ordering, e.g. 'date' | 'title' | 'menu_order'. */
    orderBy?: 'date' | 'title' | 'menu_order';
    order?: 'ASC' | 'DESC';
    /** Optional taxonomy term-slug filter for the initial render. */
    termSlug?: string;
  };
  /** Wrapper class(es) on the mount div (carried CSS hooks, e.g. 'obj-grid obj-grid--4'). */
  wrapperClass?: string;
  /**
   * Static-HTML-card path only: the ORIGINAL container selector in the source
   * DOM. The ingest neutralizer locates this element, empties its card children,
   * and stamps `selector`'s synthetic #id so injectQueryLoops matches. Undefined
   * for the JS-mount path (whose `selector` is already the source #id).
   */
  sourceSelector?: string;
  /** Static-HTML-card path only: source HTML filename used to scope neutralization per page. */
  sourcePage?: string;
  /**
   * Static-HTML-card "featured" layout: this mount renders as TWO query loops —
   * a lead loop (perPage=leadPerPage, offset=0, base card template) and a column
   * loop (perPage=columnPerPage, offset=leadPerPage, card `variant`) nested in a
   * wrapper carrying `columnWrapperClass`. Absent → single uniform loop. (B3 consumes this.)
   */
  featured?: {
    columnWrapperClass: string;
    leadPerPage: number;
    columnPerPage: number;
    /** card variant name the column loop's data-card renders (e.g. 'row'). */
    variant: string;
    /** Per-section taxonomy term-slug filter (set when the source section is category-homogeneous). Both loops of the section filter to it. */
    termSlug?: string;
    /** Taxonomy slug for the term filter (set together with termSlug). */
    taxonomy?: string;
  };
}

/**
 * The card render spec: a faithful skeleton of the source's per-item card markup
 * (e.g. maison's `objCard`) with `data-dla-*` binding directives that the
 * deterministic renderer (TS mirror + generated PHP) fills from a DataItem.
 *
 * Directives (each removed from the output after it's applied):
 *  - `data-dla-text="<expr>"`        — set the element's text to <expr>
 *  - `data-dla-attr="<a>:<expr>,…"`  — set attribute(s) from comma-separated pairs
 *  - `data-dla-class="<expr>"`       — append the resolved class token(s)
 *  - `data-dla-if="<cond>"`          — drop the element unless <cond> holds
 *
 * <expr> grammar: `'literal'` | `id` | `title` | `content` | `cat.slug` |
 *   `cat.label` | `meta.<key>` | `gallery.<n>.caption` | `map.<name>.<expr>`
 * <cond> grammar: `<expr>` (non-empty) | `<expr>=='lit'` | `<expr>!='lit'`
 */
export interface DataCard {
  /** Skeleton card HTML (one item → one card) carrying data-dla-* directives. */
  template: string;
  /** Named lookup tables referenced by `map.<name>.<expr>` (e.g. CAT_TONE). */
  maps: Record<string, Record<string, string>>;
  /** Named alternate templates (e.g. {row: "<row card skeleton>"}) the dla/data-card block renders when its `variant` attribute names one. Absent → only the base `template`. */
  variants?: Record<string, string>;
}

/** The full model the agent skill emits and the deterministic src consumes. */
export interface DataModel {
  cpt: DataCpt;
  taxonomy: DataTaxonomy;
  fields: DataField[];
  items: DataItem[];
  mounts: MountSpec[];
  /** Per-item card render spec (drives the dla/data-card dynamic block). */
  card?: DataCard;
  /**
   * Source-JS array identifiers that held the item data (e.g. ['OBJETS']).
   * Their `.find(x => x.id === …)` lookups are rebound to the WP data islands
   * so the kept modal/interaction JS reads WordPress-driven data.
   */
  sourceArrays?: string[];
  /** Schema version so persisted data-model.json invalidates on shape change. */
  schema: number;
}

export const DATA_MODEL_SCHEMA = 3;
