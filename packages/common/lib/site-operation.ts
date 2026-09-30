import { z } from 'zod';

/**
 * Studio-initiated operations that hold a site while they run. One at a time:
 * each owns the site's server process, its files, or removes the site outright.
 *
 * Syncs hold the site only while they touch it locally (`import` while
 * writing it, `export` while archiving it), not while waiting on the network.
 * `pull-reprint` streams straight into the site, so it holds it throughout.
 *
 * Distinct from the site's `status` health field: `status` records durable
 * damage that must survive a crash (a half-written `pull-failed` site stays
 * broken until repaired), whereas an operation is transient and reclaimed as
 * soon as its owning process dies.
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
	// `config set` restarts the server to apply a PHP/WordPress version or
	// domain change, so it owns the site for the duration just like a start.
	'settings',
	'duplicate',
	'import',
	'export',
] as const;

export type SiteOperationKind = ( typeof SITE_OPERATIONS )[ number ];

export const siteOperationSchema = z.object( {
	// Owning process, and the only identity an operation needs: a site holds at
	// most one at a time. Once the process is gone the entry is stale and gets
	// reclaimed, so a crashed client can never wedge a site.
	pid: z.number(),
	kind: z.enum( SITE_OPERATIONS ),
} );

export type SiteOperation = z.infer< typeof siteOperationSchema >;
