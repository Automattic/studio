import { z } from 'zod';

/**
 * Studio-initiated operations that hold a site while they run. One at a time:
 * each either owns the site's server process or removes the site outright.
 *
 * Import, pull, export and push are deliberately excluded. Export and push
 * never stop the server, so blocking a start during one only takes away a site
 * the user could still be using. Import and pull do stop it, but a sync can run
 * for tens of minutes, and holding the site for that long costs more than it
 * protects — scoping a guard to just their local write window is tracked
 * separately.
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
