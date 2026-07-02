/**
 * Shared WordPress theme-file primitives used by the replica theme builders
 * (`theme-scaffold`, `blank-theme`, …).
 *
 * These keep the style.css/functions.php boilerplate single-sourced so the
 * theme header, block registration, and slug derivation don't drift between
 * builders.
 */

/** Kebab-case slug: lowercase, non-alphanumeric runs → '-', leading/trailing '-' trimmed. */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * A `style.css` WordPress theme header comment from ordered key/value fields.
 * Emits `/*\nKey: Value\n…\n*\/\n` — callers append any trailing CSS.
 */
export function buildThemeHeader(fields: Array<[string, string]>): string {
  const body = fields.map(([key, value]) => `${key}: ${value}`).join('\n');
  return `/*\n${body}\n*/\n`;
}

/**
 * `add_action('init')` that registers every theme-embedded block found at
 * `blocks/<slug>/build` (guarded on `block.json`). Directory-driven so callers
 * don't have to enumerate block slugs — the same glob the scaffold uses.
 */
export function registerThemeBlocksPhp(): string {
  return `add_action('init', function () {
    foreach ((array) glob(get_theme_file_path('blocks/*/build')) as $build_dir) {
        if ($build_dir && file_exists(trailingslashit($build_dir) . 'block.json')) {
            register_block_type($build_dir);
        }
    }
});`;
}
