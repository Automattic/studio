/**
 * One file inside a generated theme or block plugin. `relativePath` is rooted
 * at the theme/plugin directory (e.g. "templates/index.html", not
 * "wp-content/themes/foo/templates/index.html"). Paths containing ".." or
 * leading "/" are rejected at write time to avoid escaping the install root.
 */
export interface ReplicaFile {
  relativePath: string;
  content: string;
}

/**
 * A block plugin emitted alongside the replica theme. `slug` becomes the
 * plugin folder name (kebab-case). `files` are written under
 * `wp-content/plugins/<slug>/`. The plugin is activated via wp-cli after
 * files are written.
 */
export interface ReplicaBlockPlugin {
  slug: string;
  files: ReplicaFile[];
}

export type PreviewSource = 'studio';

export interface StartPreviewResult {
  status: 'ready' | 'failed';
  url?: string;
  port?: number;
  warnings?: string[];
  error?: string;
  logTail?: string[];
  source?: PreviewSource;
  siteName?: string;
  /**
   * On-disk WP root of the provisioned site (the dir that contains `wp-content`),
   * resolved via `resolveStudioWpRoot`. Lets callers (e.g. the carry reconstruct
   * driver) use this directly as `studioSitePath` instead of re-deriving
   * `~/Studio/<siteName>`.
   */
  path?: string;
}
