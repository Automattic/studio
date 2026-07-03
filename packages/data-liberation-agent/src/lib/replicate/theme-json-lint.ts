// src/lib/replicate/theme-json-lint.ts
// Build-gate lint for generated theme.json. Catches schema-version issues AND
// the known activation FATALS that pass JSON-schema but crash WP on theme
// activation (the spacingScale.theme:false trap documented in the replicate skill).
export interface ThemeJsonLintResult { ok: boolean; errors: string[]; }

export function lintThemeJson(theme: Record<string, unknown>): ThemeJsonLintResult {
  const errors: string[] = [];
  if (theme.version !== 3) errors.push('theme.json version must be 3');
  if (!theme.$schema) errors.push('theme.json must include $schema');
  const settings = theme.settings as Record<string, unknown> | undefined;
  const spacing = settings?.spacing as Record<string, unknown> | undefined;
  const spacingScale = spacing?.spacingScale as Record<string, unknown> | undefined;
  if (spacingScale && spacingScale.theme === false) {
    errors.push('settings.spacing.spacingScale.theme:false fatals on activation; omit spacingScale when providing spacingSizes');
  }
  if (spacing?.spacingSizes && spacing?.spacingScale) {
    errors.push('provide settings.spacing.spacingSizes OR spacingScale, not both');
  }
  return { ok: errors.length === 0, errors };
}
