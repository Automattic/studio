// Shared contract for page-scoped chrome that is not present on the home page.
// Frozen in Slice 5 before behavior wiring; keep additive fields in new slices.

export interface InteriorChromeTemplate {
  /** Custom template name, without templates/ prefix or .html suffix. */
  templateName: string;
  /** Human-readable template title registered in theme.json customTemplates. */
  templateTitle: string;
  /** Template-part slug, without parts/ prefix or .html suffix. */
  partSlug: string;
  /** Block markup written to parts/<partSlug>.html. */
  partMarkup: string;
  /** Source layout wrapper tag around the rail and <main>, when one exists. */
  layoutWrapperTag?: string;
  /** Source layout wrapper classes, in order. */
  layoutWrapperClasses?: string[];
  /** Source position of the rail relative to <main> inside the layout wrapper. */
  layoutWrapperRailPosition?: 'beforeMain' | 'afterMain';
}
