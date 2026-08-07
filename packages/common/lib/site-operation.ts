import { __ } from '@wordpress/i18n';
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
} );

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

/** Present continuous, for progress UI ("Importing…"). */
export function getSiteOperationLabel( kind: SiteOperationKind ): string {
	switch ( kind ) {
		case 'start':
			return __( 'Starting' );
		case 'stop':
			return __( 'Stopping' );
		case 'delete':
			return __( 'Deleting' );
		case 'import':
			return __( 'Importing' );
		case 'pull':
			return __( 'Pulling' );
		case 'settings':
			return __( 'Saving settings' );
		case 'export':
			return __( 'Exporting' );
		case 'push':
			return __( 'Pushing' );
		case 'duplicate':
			return __( 'Duplicating' );
	}
}

// Noun phrase for sentences naming an operation. The article is part of the
// string so translators get a whole phrase to agree with, rather than an "a/an"
// the code would have to guess at.
export function getSiteOperationNoun( kind: SiteOperationKind ): string {
	switch ( kind ) {
		case 'start':
			return __( 'a site start' );
		case 'stop':
			return __( 'a site stop' );
		case 'delete':
			return __( 'a site deletion' );
		case 'import':
			return __( 'an import' );
		case 'pull':
			return __( 'a pull' );
		case 'settings':
			return __( 'a settings change' );
		case 'export':
			return __( 'an export' );
		case 'push':
			return __( 'a push' );
		case 'duplicate':
			return __( 'a duplication' );
	}
}
