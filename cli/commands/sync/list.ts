import { __, _n, sprintf } from '@wordpress/i18n';
import Table from 'cli-table3';
import { getAuthToken, readAppdata } from 'cli/lib/appdata';
import { getColumnWidths } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface SyncListEntry {
	localSite: string;
	remoteSite: string;
	remoteUrl: string;
	lastPull: string;
	lastPush: string;
}

async function getSyncListData(): Promise< SyncListEntry[] > {
	const appdata = await readAppdata();
	const result: SyncListEntry[] = [];

	// Get current user ID from auth token
	let userId: number | undefined;
	try {
		const token = await getAuthToken();
		userId = token.id;
	} catch {
		// Not authenticated, no connected sites
		return result;
	}

	if ( ! userId ) {
		return result;
	}

	const connectedSites = appdata.connectedWpcomSites?.[ userId ] || [];

	for ( const syncSite of connectedSites ) {
		// Find the local site
		const localSite = appdata.sites.find( ( site ) => site.id === syncSite.localSiteId );

		result.push( {
			localSite: localSite?.name || syncSite.localSiteId,
			remoteSite: syncSite.name,
			remoteUrl: syncSite.url,
			lastPull: syncSite.lastPullTimestamp
				? new Date( syncSite.lastPullTimestamp ).toLocaleString()
				: __( 'Never' ),
			lastPush: syncSite.lastPushTimestamp
				? new Date( syncSite.lastPushTimestamp ).toLocaleString()
				: __( 'Never' ),
		} );
	}

	return result;
}

function displaySyncList( sitesData: SyncListEntry[], format: 'table' | 'json' ): void {
	if ( format === 'table' ) {
		const colWidths = getColumnWidths( [ 0.2, 0.2, 0.25, 0.175, 0.175 ] );

		const table = new Table( {
			head: [
				__( 'Local Site' ),
				__( 'Remote Site' ),
				__( 'URL' ),
				__( 'Last Pull' ),
				__( 'Last Push' ),
			],
			wordWrap: true,
			wrapOnWordBoundary: false,
			colWidths,
			style: {
				head: [],
				border: [],
			},
		} );

		table.push(
			...sitesData.map( ( site ) => [
				site.localSite,
				site.remoteSite,
				{ href: new URL( site.remoteUrl ).toString(), content: site.remoteUrl },
				site.lastPull,
				site.lastPush,
			] )
		);

		console.log( table.toString() );
	} else {
		console.log( JSON.stringify( sitesData, null, 2 ) );
	}
}

export async function runCommand( format: 'table' | 'json' ): Promise< void > {
	const logger = new Logger();

	try {
		logger.reportStart( undefined, __( 'Loading connected sites…' ) );

		const sitesData = await getSyncListData();

		if ( sitesData.length === 0 ) {
			logger.reportSuccess( __( 'No connected sites found' ) );
			console.log(
				__( '\nUse "studio sync connect <local-site-id>" to connect a site to WordPress.com' )
			);
			return;
		}

		const sitesMessage = sprintf(
			_n( 'Found %d connected site', 'Found %d connected sites', sitesData.length ),
			sitesData.length
		);
		logger.reportSuccess( sitesMessage );

		displaySyncList( sitesData, format );
	} catch ( error ) {
		logger.spinner.stop();
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to list connected sites' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list',
		describe: __( 'List connected WordPress.com sites' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ] as const,
					default: 'table' as const,
					description: __( 'Output format' ),
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.format );
		},
	} );
};
