import { z } from 'zod';

/**
 * Studio-initiated operations that hold a site while they run. One at a time:
 * every one of them either owns the site's server process or writes inside its
 * directory — even the ones that look read-only, since `export` and `push`
 * refresh the SQLite integration (an `rm -rf` plus a copy under `wp-content`)
 * before they read anything.
 *
 * Distinct from the site's `status` health field: `status` records durable
 * damage that must survive a crash (a half-written `pull-failed` site stays
 * broken until repaired), whereas an operation is a lease reclaimed as soon
 * as its owning process dies.
 *
 * `duplicate` is the one kind no CLI command writes — the desktop and the
 * local server each copy the directory themselves, and neither the CLI nor
 * the agent can trigger it. It's tracked client-side from the in-flight
 * mutation instead, which is sufficient precisely because the UI is the only
 * thing that can start one.
 */
export const SITE_OPERATIONS = [
	'start',
	'stop',
	'delete',
	'import',
	'pull',
	// `config set` restarts the server to apply a PHP/WordPress version or
	// domain change, so it owns the site for the duration just like a start.
	'settings',
	'export',
	'push',
	'duplicate',
] as const;

export type SiteOperationKind = ( typeof SITE_OPERATIONS )[ number ];

export const siteOperationSchema = z.object( {
	// Identifies the lease on release, so a process releasing one lease can't
	// clear a different one that happens to share its PID.
	id: z.string(),
	// PID of the process holding the lease. A lease whose owner is gone is
	// stale and gets reclaimed, so a crashed client can never wedge a site.
	pid: z.number(),
	kind: z.enum( SITE_OPERATIONS ),
} );

export type SiteOperation = z.infer< typeof siteOperationSchema >;

/** The operation to describe a busy site by, or null when it's idle. */
export function getBlockingOperation(
	operations: SiteOperation[] | undefined
): SiteOperationKind | null {
	return operations?.[ 0 ]?.kind ?? null;
}
