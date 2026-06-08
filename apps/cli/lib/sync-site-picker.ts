import { search } from '@inquirer/prompts';
import chalk from '@studio/common/lib/chalk';
import { __, sprintf } from '@wordpress/i18n';
import { normalizeHostname } from 'cli/lib/utils';
import { LoggerError } from 'cli/logger';
import type { SyncSite } from '@studio/common/types/sync';

function throwSyncSupportError( site: SyncSite ): never {
	if ( site.syncSupport === 'needs-transfer' ) {
		throw new LoggerError(
			sprintf(
				__(
					'Site %1$s requires hosting features to be enabled. Please visit https://wordpress.com/hosting-features/%2$d to activate them, then try again.'
				),
				site.name,
				site.id
			)
		);
	}
	throw new LoggerError(
		sprintf( __( 'Site %1$s is not syncable (%2$s)' ), site.name, site.syncSupport )
	);
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
		default:
			return syncSupport;
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
