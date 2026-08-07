import { z } from 'zod';

/**
 * Studio-initiated operations that hold a site while they run.
 *
 * Distinct from the site's `status` health field: `status` records durable
 * damage that must survive a crash (a half-written `pull-failed` site stays
 * broken until repaired), whereas an operation is a lease reclaimed as soon
 * as its owning process dies.
 *
 * Exclusive operations rewrite the site tree or own its server process, so
 * they run alone. Shared operations only read the tree, so they run
 * alongside each other but never alongside an exclusive one.
 *
 * `duplicate` is the one kind no CLI command writes — the desktop and the
 * local server each copy the directory themselves, and neither the CLI nor
 * the agent can trigger it. It's tracked client-side from the in-flight
 * mutation instead, which is sufficient precisely because the UI is the only
 * thing that can start one.
 */
export const SITE_OPERATIONS = {
	start: 'exclusive',
	stop: 'exclusive',
	delete: 'exclusive',
	import: 'exclusive',
	pull: 'exclusive',
	// `config set` restarts the server to apply a PHP/WordPress version or
	// domain change, so it owns the site for the duration just like a start.
	settings: 'exclusive',
	export: 'shared',
	push: 'shared',
	duplicate: 'shared',
} as const;

export type SiteOperationKind = keyof typeof SITE_OPERATIONS;

const siteOperationKinds = Object.keys( SITE_OPERATIONS ) as [
	SiteOperationKind,
	...SiteOperationKind[],
];

export const siteOperationSchema = z.object( {
	// Identifies the lease on release. A process can hold two shared leases at
	// once (the local server exports and pushes from one process), so pid and
	// start time don't tell them apart.
	id: z.string(),
	// PID of the process holding the lease. A lease whose owner is gone is
	// stale and gets reclaimed, so a crashed client can never wedge a site.
	pid: z.number(),
	kind: z.enum( siteOperationKinds ),
	startedAt: z.number(),
} );

/**
 * Ceiling on how long a lease is believed, regardless of its PID.
 *
 * PID liveness alone leaves one hole: if the owning process dies and the OS
 * later reuses its PID for something unrelated, the dead lease looks held and
 * the site is blocked with no way out but editing cli.json by hand. Reboots are
 * the common case and are caught precisely by comparing against boot time; this
 * is the backstop for PID reuse within a single boot. Nothing Studio runs
 * against one site takes a day, so anything older is a leak.
 */
export const SITE_OPERATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type SiteOperation = z.infer< typeof siteOperationSchema >;

function isExclusiveOperation( kind: SiteOperationKind ): boolean {
	return SITE_OPERATIONS[ kind ] === 'exclusive';
}

export function conflictsWith( held: SiteOperationKind, requested: SiteOperationKind ): boolean {
	return isExclusiveOperation( held ) || isExclusiveOperation( requested );
}

/**
 * The operation to describe a busy site by. Exclusive ones win — they're the
 * ones blocking everything else, so they're what a user needs told about.
 */
export function getBlockingOperation(
	operations: SiteOperation[] | undefined
): SiteOperationKind | null {
	if ( ! operations?.length ) {
		return null;
	}
	const blocking = operations.find( ( operation ) => isExclusiveOperation( operation.kind ) );
	return ( blocking ?? operations[ 0 ] ).kind;
}
