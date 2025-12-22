import { __, _n, sprintf } from '@wordpress/i18n';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from 'common/constants';
import { arePathsEqual } from 'common/lib/fs-utils';
import {
	getWordPressVersionUrl,
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from 'common/lib/wordpress-version-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	getSiteByFolder,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( siteFolder: string, wpVersion: string ): Promise< void > {
	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	let site = await getSiteByFolder( siteFolder );
	logger.reportSuccess( __( 'Site loaded' ) );

	try {
		await connect();
		const processDescription = await isServerRunning( site.id );

		if ( processDescription ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress site…' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress site stopped' ) );
		}

		logger.reportStart( LoggerAction.SET_WP_VERSION, __( 'Changing WordPress version…' ) );
		const phpVersion = validatePhpVersion( site.phpVersion );
		const zipUrl = getWordPressVersionUrl( wpVersion );
		const [ response, closeWpCliServer ] = await runWpCliCommand(
			siteFolder,
			phpVersion,
			site.port,
			[ 'core', 'update', zipUrl, '--force', '--skip-plugins', '--skip-themes' ]
		);

		if ( ( await response.exitCode ) !== 0 ) {
			throw new LoggerError(
				sprintf( __( `Failed to update WordPress version to %s` ), wpVersion )
			);
		}

		logger.reportSuccess( __( 'WordPress version changed' ) );

		try {
			await lockAppdata();
			const appdata = await readAppdata();
			const foundSite = appdata.sites.find( ( site ) => arePathsEqual( site.path, siteFolder ) );
			if ( ! foundSite ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}
			site = foundSite;
			site.isWpAutoUpdating = wpVersion === DEFAULT_WORDPRESS_VERSION;
			await saveAppdata( appdata );
		} finally {
			await unlockAppdata();
		}

		if ( processDescription ) {
			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress site…' ) );
			const processDesc = await startWordPressServer( site, logger );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			logger.reportSuccess( __( 'WordPress site started' ) );
		}

		await closeWpCliServer();
		process.exit( await response.exitCode );
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set-wp-version <wp-version>',
		describe: __( 'Set WordPress version for a local site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'wp-version', {
				type: 'string',
				description: __( 'WordPress version' ),
				demandOption: true,
				coerce: ( value: string ) => {
					if ( ! isValidWordPressVersion( value ) ) {
						throw new ValidationError(
							'wp',
							value,
							__(
								'Must be: "latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")'
							)
						);
					}
					if ( ! isWordPressVersionAtLeast( value, MINIMUM_WORDPRESS_VERSION ) ) {
						throw new ValidationError(
							'wp',
							value,
							sprintf( __( 'Must be: at least %s' ), MINIMUM_WORDPRESS_VERSION )
						);
					}
					return value;
				},
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.wpVersion );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to start site infrastructure' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
