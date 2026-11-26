import chalk from '@studio/common/lib/chalk';
import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { connectPublishingSite, getRemoteSites } from '@studio/common/lib/remote-sites';
import { lastTransferTime } from '@studio/common/lib/site-connections';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { resolveRemoteSite } from '@studio/common/sites/remote-sites';
import {
	getFormFields,
	getProvider,
	getProviderSites,
	type ProviderSites,
	type RemoteSite,
	type SitesProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { search } from 'cli/lib/prompts';
import { askFormFields } from 'cli/lib/providers';
import { toLoggerError } from 'cli/lib/sync-api';
import { Logger, LoggerError } from 'cli/logger';
import type { SyncSite } from '@studio/common/types/sync';

/**
 * Maps a site's `syncSupport` state to a clear, actionable error explaining
 * why it can't be synced. Shared by every CLI sync command (push and
 * pull) so a Business-plan site awaiting Atomic transfer, a site that
 * needs a plan upgrade, and so on each report the specific condition and next
 * step instead of a generic failure or a raw internal state identifier.
 */
export function getSyncSupportError( site: SyncSite ): LoggerError {
	switch ( site.syncSupport ) {
		case 'needs-transfer':
			return new LoggerError(
				sprintf(
					// translators: %1$s: site name. %2$d: WordPress.com site ID.
					__(
						'Site %1$s requires hosting features to be enabled. Please visit https://wordpress.com/hosting-features/%2$d to activate them, then try again.'
					),
					site.name,
					site.id
				)
			);
		case 'needs-upgrade':
			return new LoggerError(
				sprintf(
					// translators: %1$s: site name. %2$d: WordPress.com site ID.
					__(
						'Site %1$s requires a plan with hosting features to sync. Please upgrade at https://wordpress.com/plans/%2$d, then try again.'
					),
					site.name,
					site.id
				)
			);
		case 'missing-permissions':
			return new LoggerError(
				sprintf(
					// translators: %s: site name.
					__(
						'You do not have permission to sync site %s. Please ask a site administrator for access, then try again.'
					),
					site.name
				)
			);
		case 'unsupported':
			return new LoggerError(
				sprintf(
					// translators: %s: site name.
					__(
						'Site %s is hosted somewhere Studio cannot sync with. Only WordPress.com and Pressable sites are supported.'
					),
					site.name
				)
			);
		case 'deleted':
			return new LoggerError(
				sprintf(
					// translators: %s: site name.
					__( 'Site %s has been deleted and can no longer be synced.' ),
					site.name
				)
			);
		case 'already-connected':
			return new LoggerError(
				sprintf(
					// translators: %s: site name.
					__( 'Site %s is already connected to another local site.' ),
					site.name
				)
			);
		default:
			return new LoggerError(
				sprintf(
					// translators: %s: site name.
					__( 'Site %s cannot be synced.' ),
					site.name
				)
			);
	}
}

function throwSyncSupportError( site: SyncSite ): never {
	throw getSyncSupportError( site );
}

export function findSyncSiteByIdentifier( sites: SyncSite[], identifier: string ): SyncSite {
	// Try numeric ID match first
	const numericId = Number( identifier );
	if ( ! isNaN( numericId ) ) {
		const site = sites.find( ( s ) => s.id === numericId );
		if ( site ) {
			if ( site.syncSupport !== 'syncable' ) {
				throwSyncSupportError( site );
			}
			return site;
		}
	}

	// Try URL/hostname match
	const normalizedIdentifier = normalizeHostname( identifier );
	const matched = sites.filter( ( s ) => normalizeHostname( s.url ) === normalizedIdentifier );

	if ( matched.length === 0 ) {
		throw new LoggerError( sprintf( __( 'No site found matching "%s"' ), identifier ) );
	}

	if ( matched.length > 1 ) {
		throw new LoggerError(
			sprintf(
				__( 'Multiple sites match "%1$s". Use the site ID instead: %2$s' ),
				identifier,
				matched.map( ( s ) => `${ s.name } (ID: ${ s.id })` ).join( ', ' )
			)
		);
	}

	const site = matched[ 0 ];
	if ( site.syncSupport !== 'syncable' ) {
		throwSyncSupportError( site );
	}

	return site;
}

function getSyncSupportLabel( syncSupport: SyncSite[ 'syncSupport' ] ): string {
	switch ( syncSupport ) {
		case 'needs-upgrade':
			return __( 'Plan upgrade required' );
		case 'needs-transfer':
			return __( 'Transfer required' );
		case 'unsupported':
			return __( 'Unsupported site' );
		case 'deleted':
			return __( 'Deleted' );
		case 'missing-permissions':
			return __( 'Missing permissions' );
		case 'already-connected':
			return __( 'Already connected' );
		default:
			return __( 'Not syncable' );
	}
}

function formatSiteChoice( site: SyncSite ): string {
	const parts = [ site.name ];

	const hostname = normalizeHostname( site.url );
	parts.push( chalk.dim( hostname ) );

	if ( site.isStaging ) {
		parts.push( chalk.yellow( __( '[staging]' ) ) );
	}

	return parts.join( ' ' );
}

export async function pickSyncSite(
	sites: SyncSite[],
	message: string
): Promise< SyncSite | undefined > {
	const syncable = sites.filter( ( s ) => s.syncSupport === 'syncable' );
	const nonSyncable = sites.filter( ( s ) => s.syncSupport !== 'syncable' );

	if ( syncable.length === 0 ) {
		console.log( __( 'No syncable sites found.' ) );
		return undefined;
	}

	const allChoices = [
		...syncable.map( ( site ) => ( {
			name: formatSiteChoice( site ),
			value: site.id,
		} ) ),
		...nonSyncable.map( ( site ) => ( {
			name: formatSiteChoice( site ),
			value: site.id,
			disabled: chalk.red( `(${ getSyncSupportLabel( site.syncSupport ) })` ),
		} ) ),
	];

	const abortController = new AbortController();
	const handleEscKey = ( chunk: Buffer | string ) => {
		const bytes = Buffer.isBuffer( chunk ) ? chunk : Buffer.from( chunk );
		if ( bytes.length === 1 && bytes[ 0 ] === 0x1b ) {
			abortController.abort();
		}
	};

	if ( process.stdin.isTTY ) {
		process.stdin.on( 'data', handleEscKey );
	}

	try {
		const selectedId = await search(
			{
				message,
				source: ( term ) => {
					if ( ! term ) {
						return allChoices;
					}
					const lowerTerm = term.toLowerCase();
					return allChoices.filter( ( choice ) => {
						const site = sites.find( ( s ) => s.id === choice.value );
						if ( ! site ) {
							return false;
						}
						return (
							site.name.toLowerCase().includes( lowerTerm ) ||
							normalizeHostname( site.url ).toLowerCase().includes( lowerTerm )
						);
					} );
				},
				pageSize: 12,
				theme: {
					style: {
						keysHelpTip: () =>
							chalk.dim(
								[
									__( '↑↓ navigate' ),
									__( 'type to filter' ),
									__( '⏎ select' ),
									__( 'esc cancel' ),
								].join( ' · ' )
							),
					},
				},
			},
			{
				signal: abortController.signal,
			}
		);

		return sites.find( ( site ) => site.id === selectedId );
	} catch ( error ) {
		if (
			error instanceof Error &&
			( error.name === 'AbortPromptError' || error.name === 'ExitPromptError' )
		) {
			return undefined;
		}
		throw error;
	} finally {
		if ( process.stdin.isTTY ) {
			process.stdin.off( 'data', handleEscKey );
		}
	}
}

// The site `identifier` names: its ID, its URL's host, or its slug.
export function findRemoteSite< Site extends RemoteSite >(
	sites: Site[],
	identifier: string
): Site | undefined {
	const normalized = normalizeHostname( identifier );
	return sites.find(
		( candidate ) =>
			String( candidate.id ) === identifier ||
			normalizeHostname( candidate.url ) === normalized ||
			( 'slug' in candidate && candidate.slug === identifier )
	);
}

// The local site's connections to the provider's sites, the one last pushed to or pulled from first.
export async function connectedSites< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string
): Promise< ProviderSites[ Id ][] > {
	return ( await getRemoteSites( provider, localSiteId ) )
		.sort( ( a, b ) => ( lastTransferTime( b ) ?? 0 ) - ( lastTransferTime( a ) ?? 0 ) )
		.map(
			( {
				localSiteId: _localSiteId,
				lastPushTimestamp: _push,
				lastPullTimestamp: _pull,
				localVersionId: _version,
				...site
			} ) => site as unknown as ProviderSites[ Id ]
		);
}

/**
 * A site of a provider whose sites the user connects with a form (`sites.connect`): the connected
 * site `identifier` names, or the one last synced without it, or else one connected now, from
 * `identifier` or, in a terminal, the provider's form.
 */
export async function resolveFormConnectedSite(
	provider: SitesProviderId,
	localSiteId: string,
	identifier: string | undefined,
	logger: Logger< LoggerAction >
): Promise< ProviderSites[ SitesProviderId ] > {
	const connected = await connectedSites( provider, localSiteId );
	const known = identifier ? findRemoteSite( connected, identifier ) : connected[ 0 ];
	if ( known ) {
		return known;
	}
	const { label } = getProvider( provider );
	const from = identifier
		? { id: identifier }
		: process.stdin.isTTY
		? {
				input: await askFormFields(
					getFormFields( getProviderSites( provider ).connect!.input() )
				),
		  }
		: undefined;
	if ( ! from ) {
		throw new LoggerError(
			sprintf( __( 'Choose a site with `--remote-site %s:<site>`.' ), provider )
		);
	}
	logger.reportStart(
		LoggerAction.FETCH_REMOTE_SITES,
		sprintf( __( 'Connecting to the %s site…' ), label )
	);
	try {
		const site = await resolveRemoteSite( getProviderServices( provider ), from );
		await connectPublishingSite( provider, localSiteId, site );
		logger.spinner.stop();
		return site;
	} catch ( error ) {
		throw toLoggerError( error, sprintf( __( 'Could not connect to the %s site' ), label ) );
	}
}
