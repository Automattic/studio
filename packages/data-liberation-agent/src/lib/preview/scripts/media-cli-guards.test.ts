import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string): string => readFileSync(join(here, f), 'utf8');

// Both vendored WP-CLI scripts loop over media (wp_insert_attachment +
// wp_generate_attachment_metadata). On media-heavy sites that runs SILENTLY long
// enough to trip Studio's 120s IPC-silence timeout, which kills the whole install.
// Each MUST (1) skip intermediate image-size generation and (2) emit a WP-CLI
// heartbeat so the timer resets. This guards against the fix being lost in one script —
// it already had to be added twice (import-wxr.php, then install-media.php; 2026-06-04).
describe('vendored WP-CLI media scripts carry the Studio-timeout guards', () => {
  for (const script of ['import-wxr.php', 'install-media.php']) {
    const src = read(script);
    it(`${script} skips intermediate image sizes`, () => {
      expect(src).toContain("add_filter( 'intermediate_image_sizes_advanced', '__return_empty_array' )");
    });
    it(`${script} emits a WP-CLI heartbeat to keep the IPC channel active`, () => {
      expect(src).toContain('WP_CLI::log');
    });
  }
});
