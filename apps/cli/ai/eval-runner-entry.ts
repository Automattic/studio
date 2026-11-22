import { mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimPortRange } from './eval-port-range';

// Each case creates its sites in a folder of its own, so concurrent cases,
// including repeats of one case, never share or delete each other's sites.
// Set before the runner loads: the sites root is read once, when site-paths loads.
process.env.E2E = '1';
process.env.E2E_SITES_ROOT = realpathSync(
	mkdtempSync( path.join( os.tmpdir(), 'studio-eval-sites-' ) )
);
// And runs them under a process manager of its own, so the sites the user
// runs in Studio, up to the manager's limit, never keep a case's from
// starting, and the case's PHP never queues behind theirs. Set before the
// runner loads: the daemon paths are read once, when cli/lib/paths loads.
process.env.STUDIO_PROCESS_MANAGER_HOME = mkdtempSync(
	path.join( os.tmpdir(), 'studio-eval-pm-' )
);

// Set before the port finder loads: it reads its first port then. A port the
// user picked stays theirs.
void ( async () => {
	process.env.STUDIO_BASE_PORT ??= String( await claimPortRange() );
	await import( './eval-runner' );
} )();
