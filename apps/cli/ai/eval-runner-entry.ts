import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each case creates its sites in a folder of its own, so concurrent cases,
// including repeats of one case, never share or delete each other's sites.
// Set before the runner loads: the sites root is read once, when site-paths loads.
process.env.E2E = '1';
process.env.E2E_SITES_ROOT = realpathSync(
	mkdtempSync( path.join( os.tmpdir(), 'studio-eval-sites-' ) )
);

void import( './eval-runner' );
