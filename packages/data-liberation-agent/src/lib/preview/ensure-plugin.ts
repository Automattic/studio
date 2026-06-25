//
// Ensure Plugin — Idempotent WP Plugin Installer
// ================================================
// Generic groundwork: installs and activates a plugin on a Studio site if it
// isn't already present and active. Used for safe-svg (SVG survival) and
// Jetpack (form blocks) today; WooCommerce auto-install is a one-line follow-up.
//
// The exec parameter matches the StudioWpRunner shape from studio.ts so callers
// can pass studioWp directly and tests inject a mock:
//   (sitePath: string, args: string[]) => Promise<string>
//   → runs `studio wp --path <sitePath> <...args>` (throws on non-zero exit)
//
// Contract:
//   installed AND active  → {ok:true, action:'none'}       (no exec calls)
//   installed, inactive   → activate only → {ok:true, action:'activated'}
//   not installed         → install --activate → {ok:true, action:'installed'}
//   any failure           → {ok:false, error:<message>}    — NEVER throws
//

export type ExecFn = (sitePath: string, args: string[]) => Promise<string>;

export type EnsureResult =
  | { ok: true; action: 'none' | 'activated' | 'installed' }
  | { ok: false; error: string };

export async function ensurePlugin(
  sitePath: string,
  slug: string,
  exec: ExecFn,
): Promise<EnsureResult> {
  try {
    // `wp plugin is-installed` exits 0 if installed (active or inactive), non-zero otherwise.
    let installed = true;
    try {
      await exec(sitePath, ['plugin', 'is-installed', slug]);
    } catch {
      installed = false;
    }

    if (!installed) {
      await exec(sitePath, ['plugin', 'install', slug, '--activate']);
      return { ok: true, action: 'installed' };
    }

    // `wp plugin is-active` exits 0 if active, non-zero if installed but inactive.
    let active = true;
    try {
      await exec(sitePath, ['plugin', 'is-active', slug]);
    } catch {
      active = false;
    }

    if (!active) {
      await exec(sitePath, ['plugin', 'activate', slug]);
      return { ok: true, action: 'activated' };
    }

    return { ok: true, action: 'none' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
