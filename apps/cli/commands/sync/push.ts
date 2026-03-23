import { SYNC_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncOption } from '@studio/common/types/sync';

const VALID_OPTIONS: SyncOption[] = [ 'all', 'sqls', 'uploads', 'plugins', 'themes', 'contents' ];

function parseOptions( optionsString?: string ): SyncOption[] {
	if ( ! optionsString ) {
		return [ 'all' ];
	}

	const options = optionsString.split( ',' ).map( ( o ) => o.trim() ) as SyncOption[];
	for ( const option of options ) {
		if ( ! VALID_OPTIONS.includes( option ) ) {
			throw new LoggerError(
				sprintf(
					__( 'Invalid sync option: %s. Valid options: %s' ),
					option,
					VALID_OPTIONS.join( ', ' )
				)
			);
		}
	}

	return options;
}

export async function runCommand( siteFolder: string, optionsString?: string ): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		const site = await getSiteByFolder( siteFolder );
		parseOptions( optionsString );

		logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching WordPress.com sites…' ) );
		const sites = await fetchSyncableSites( token.accessToken );
		logger.reportSuccess( sprintf( __( 'Found %d sites' ), sites.length ), true );

		const selectedSite = await pickSyncSite( sites, __( 'Select a site to push to' ) );
		if ( ! selectedSite ) {
			return;
		}

		void emitCliEvent( {
			event: SYNC_EVENTS.STARTED,
			data: {
				event: SYNC_EVENTS.STARTED,
				type: 'push',
				localSiteId: site.id,
				remoteSiteId: selectedSite.id,
				remoteSiteName: selectedSite.name,
			},
		} );

		// TODO: Implement push flow once the export/import module is available in CLI.
		// Steps needed:
		// 1. Export local site to tar.gz archive (requires export-manager)
		// 2. Validate archive size (< SYNC_PUSH_SIZE_LIMIT_BYTES)
		// 3. TUS upload via tusUpload() from sync-api.ts
		// 4. Initiate import via initiateImport() from sync-api.ts
		// 5. Poll import status via pollImportStatus() from sync-api.ts
		// 6. Emit SYNC_EVENTS.COMPLETED on success
		throw new LoggerError(
			__(
				'Local site export is not yet implemented in CLI. This feature requires the export/import module.'
			)
		);
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Push failed' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'push',
		describe: __( 'Push your local site to a WordPress.com site' ),
		builder: ( yargs ) => {
			return yargs.option( 'options', {
				type: 'string',
				description: __(
					'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents'
				),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.options );
		},
	} );
};
