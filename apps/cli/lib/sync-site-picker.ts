import { select } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import chalk from 'chalk';
import type { SyncSite } from '@studio/common/types/sync';

function getSyncSupportLabel( syncSupport: string ): string {
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

	const hostname = site.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
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

	const choices = [
		...syncable.map( ( site ) => ( {
			name: formatSiteChoice( site ),
			value: site.id,
		} ) ),
		...nonSyncable.map( ( site ) => ( {
			name: `${ formatSiteChoice( site ) } ${ chalk.red(
				`(${ getSyncSupportLabel( site.syncSupport ) })`
			) }`,
			value: site.id,
			disabled: getSyncSupportLabel( site.syncSupport ),
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
		const selectedId = await select(
			{
				message,
				choices,
				pageSize: 12,
				loop: false,
				theme: {
					style: {
						keysHelpTip: () => chalk.dim( '↑↓ navigate · ⏎ select · esc cancel' ),
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
