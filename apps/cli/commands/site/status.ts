import { getSiteWpRoot } from '@studio/common/lib/cli-events';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { decodePassword } from '@studio/common/lib/passwords';
import { getSiteFileAccess, SITE_FILE_ACCESS_ALL_FILES } from '@studio/common/lib/site-file-access';
import { getSiteRuntime, SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { loadWpEnvConfig, WP_ENV_FILE } from '@studio/common/lib/wp-env/config';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getPrettyPath } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( siteFolder: string, format: 'table' | 'json' ): Promise< void > {
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		const isOnline = Boolean( await isServerRunning( site.id ) );
		const status = isOnline ? `🟢 ${ __( 'Online' ) }` : `🔴 ${ __( 'Offline' ) }`;
		const siteUrl = getSiteUrl( site );
		const sitePath = getPrettyPath( site.path );
		// For wp-env project sites, WordPress lives in the technical directory,
		// not at the (project) site path.
		const wpRoot = getSiteWpRoot( site );
		const wpVersion = getWordPressVersion( wpRoot );
		const autoLoginUrl = new URL( siteUrl );
		autoLoginUrl.pathname = `/studio-auto-login`;
		autoLoginUrl.searchParams.set( 'redirect_to', `/wp-admin/` );

		/* translators: status value for the Xdebug setting in the site status output */
		const xdebugStatus = site.enableXdebug ? __( 'Enabled' ) : __( 'Disabled' );

		const runtime = getSiteRuntime( site );
		const fileAccess = getSiteFileAccess( site );
		/* translators: As in an application that runs natively on a computer */
		const nativeLabel = __( 'Native' );
		/* translators: As in a secure, sandboxed environment */
		const sandboxLabel = __( 'Sandbox' );
		const runtimeLabel = runtime === SITE_RUNTIME_NATIVE_PHP ? nativeLabel : sandboxLabel;
		const fileAccessLabel =
			/* translators: value for the File access setting in the site status output */
			fileAccess === SITE_FILE_ACCESS_ALL_FILES ? __( 'All files' ) : __( 'Site directory' );

		// PHP is annotated only while the site still matches the file; the
		// WordPress version is file-owned whenever `core` is set (a conflicting
		// `--wp` is refused at create/set time).
		const isWpEnvSite = site.projectType === 'wp-env';
		let wpEnvOwnsWpVersion = false;
		let wpEnvPhpVersion: string | undefined;
		if ( isWpEnvSite ) {
			try {
				const loaded = loadWpEnvConfig( site.path );
				wpEnvOwnsWpVersion = loaded?.config.core != null;
				wpEnvPhpVersion = loaded?.config.phpVersion ?? undefined;
			} catch {
				// An invalid project file shouldn't break status output.
			}
		}
		const annotateFromWpEnv = ( value: string | undefined, owned: boolean ) =>
			value && owned
				? sprintf(
						/* translators: %1$s: the setting value, %2$s: the wp-env config file name */
						__( '%1$s (from %2$s)' ),
						value,
						WP_ENV_FILE
				  )
				: value;

		const siteData: {
			key: string;
			jsonKey: string;
			value: string | undefined;
			jsonValue?: string;
			type?: string;
			hidden?: boolean;
		}[] = [
			{
				key: __( 'Site URL' ),
				jsonKey: 'siteUrl',
				value: new URL( siteUrl ).toString(),
				type: 'url',
			},
			{
				key: __( 'Auto-login URL' ),
				jsonKey: 'autoLoginUrl',
				value: autoLoginUrl.toString(),
				type: 'url',
				hidden: ! isOnline,
			},
			{ key: __( 'Site Path' ), jsonKey: 'sitePath', value: sitePath },
			{
				key: __( 'WordPress Path' ),
				jsonKey: 'wpRootPath',
				value: isWpEnvSite ? getPrettyPath( wpRoot ) : undefined,
			},
			{ key: __( 'Status' ), jsonKey: 'status', value: status },
			{
				key: __( 'PHP version' ),
				jsonKey: 'phpVersion',
				value: annotateFromWpEnv( site.phpVersion, site.phpVersion === wpEnvPhpVersion ),
				jsonValue: site.phpVersion,
			},
			{ key: __( 'PHP runtime' ), jsonKey: 'runtime', value: runtimeLabel },
			{ key: __( 'File access' ), jsonKey: 'fileAccess', value: fileAccessLabel },
			{
				key: __( 'WP version' ),
				jsonKey: 'wpVersion',
				value: annotateFromWpEnv( wpVersion, wpEnvOwnsWpVersion ),
				jsonValue: wpVersion,
			},
			{ key: __( 'Xdebug' ), jsonKey: 'xdebug', value: xdebugStatus },
			{
				key: __( 'Admin username' ),
				jsonKey: 'adminUsername',
				value: site.adminUsername ?? 'admin',
			},
			{
				key: __( 'Admin password' ),
				jsonKey: 'adminPassword',
				value: site.adminPassword ? decodePassword( site.adminPassword ) : undefined,
			},
			{ key: __( 'Admin email' ), jsonKey: 'adminEmail', value: site.adminEmail },
		].filter( ( { value, hidden } ) => value && ! hidden );

		if ( format === 'table' ) {
			const table = new CliTable3( {
				wordWrap: true,
				wrapOnWordBoundary: false,
				style: {
					head: [],
					border: [],
				},
			} );

			for ( const { key, value, type } of siteData ) {
				table.push( [ key, type === 'url' ? { href: value, content: value } : value ] );
			}

			console.table( table.toString() );
		} else {
			const logData = Object.fromEntries(
				siteData.flatMap( ( { jsonKey, value, jsonValue } ) =>
					jsonKey === 'status'
						? [
								[ jsonKey, value ],
								[ 'isOnline', isOnline ],
						  ]
						: [ [ jsonKey, jsonValue ?? value ] ]
				)
			);

			console.log( JSON.stringify( logData, null, 2 ) );
		}
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status',
		describe: __( 'Get status of site' ),
		builder: ( yargs ) => {
			return yargs.option( 'format', {
				type: 'string',
				choices: [ 'table', 'json' ] as const,
				default: 'table' as const,
				description: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.format );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to load site status' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
