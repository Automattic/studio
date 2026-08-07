import { getSiteOperationLabel, type SiteOperationKind } from '@studio/common/lib/site-operation';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import type { SiteStatus } from './dropdown-trigger';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';

export function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function ensureProtocol( url: string ): string {
	return /^https?:\/\//.test( url ) ? url : `https://${ url }`;
}

export function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	// Prefer the production (non-staging) site; fall back to anything connected
	// so a staging-only link is still surfaced rather than silently dropped.
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

export function pickLatestSnapshot(
	snapshots: Snapshot[] | undefined,
	siteId: string
): Snapshot | undefined {
	if ( ! snapshots ) {
		return undefined;
	}
	// `date` is a unix timestamp; the most recent snapshot wins.
	return snapshots
		.filter( ( snapshot ) => snapshot.localSiteId === siteId )
		.reduce< Snapshot | undefined >( ( latest, candidate ) => {
			if ( ! latest || candidate.date > latest.date ) {
				return candidate;
			}
			return latest;
		}, undefined );
}

// `Snapshot.url` is stored as a bare hostname. The CLI `preview update`
// subcommand expects that same hostname as its positional arg, so use this
// helper when passing a snapshot back to publish/update actions — otherwise
// an `https://…/` prefix would cause the command to spawn a new preview.
export function getSnapshotHostname( snapshot: Snapshot ): string {
	return stripProtocol( snapshot.url );
}

// Derives the running/transitioning/stopped status plus the user-visible
// labels for the local-site row. Collapses three related but noisy branches
// into a single helper the dropdown can consume in one line.
export function deriveSiteStatus(
	site: SiteDetails,
	isStarting: boolean,
	isStopping: boolean,
	// From `useSiteOperation` — covers work this window didn't start (an agent
	// export, another Studio window) plus an in-flight duplicate. Passed in
	// rather than derived here for the same reason as the flags above: it's
	// react-query state, and this stays a pure function.
	operation: SiteOperationKind | null
): { status: SiteStatus; statusLabel: string; localSublabel: string } {
	const status: SiteStatus =
		operation || isStarting || isStopping ? 'transitioning' : site.running ? 'running' : 'stopped';

	const statusLabel = operation
		? getSiteOperationLabel( operation )
		: status === 'running'
		? __( 'Site is running' )
		: status === 'transitioning'
		? isStopping
			? __( 'Site is stopping' )
			: __( 'Site is starting' )
		: __( 'Site is stopped' );

	const localSublabel = operation
		? // translators: %s: an operation in progress, e.g. "Exporting".
		  sprintf( __( '%s…' ), getSiteOperationLabel( operation ) )
		: status === 'transitioning'
		? isStopping
			? __( 'Stopping…' )
			: __( 'Starting…' )
		: getSiteDisplayUrl( site );

	return { status, statusLabel, localSublabel };
}
