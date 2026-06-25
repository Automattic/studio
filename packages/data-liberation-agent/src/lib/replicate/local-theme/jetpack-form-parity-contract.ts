export const JETPACK_FORM_PARITY_CSS = {
  /** Theme-relative CSS asset written only when Jetpack form parity CSS is non-empty. */
  themeRelativePath: 'assets/css/jetpack-form-parity.css',
  /** Output-dir mirror written by convert-local-site for inspection/debugging. */
  outputFileName: 'jetpack-form-parity.css',
  /** Frontend enqueue handle suffix: `${themeSlug}-jetpack-form-parity`. */
  frontendHandleSuffix: 'jetpack-form-parity',
  /** Editor canvas loading uses add_editor_style with the same theme-relative path. */
  editorStylePath: 'assets/css/jetpack-form-parity.css',
} as const;

export type JetpackFormParityCssAsset = typeof JETPACK_FORM_PARITY_CSS;
