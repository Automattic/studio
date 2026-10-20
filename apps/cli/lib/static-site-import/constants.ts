// Without an explicit importer, `--from` installs the newest Static Site Importer release (see
// `cli/lib/import-runtime`), which vendors the matching Blocks Engine. To run an unreleased build, pass a paired zip
// from the importer's `npm run build:dev-package` to `--static-site-importer-path`.
export const SSI_PLUGIN_SLUG = 'static-site-importer';
export const STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS = 30_000;
