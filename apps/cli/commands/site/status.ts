import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { decodePassword } from '@studio/common/lib/passwords';
import { getSiteFileAccess, SITE_FILE_ACCESS_ALL_FILES } from '@studio/common/lib/site-file-access';
import { getSiteRuntime, SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n } from '@wordpress/i18n';
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
		const wpVersion = getWordPressVersion( site.path );
		const autoLoginUrl = new URL( siteUrl );
		autoLoginUrl.pathname = `/studio-auto-login`;
		autoLoginUrl.searchParams.set( 'redirect_to', `/wp-admin/` );

		/* translators: status value for the Xdebug setting in the site status output */
		const xdebugStatus = site.enableXdebug ? __( 'Enabled' ) : __( 'Disabled' );

		const runtime = getSiteRuntime( site );
		const fileAccess = getSiteFileAccess( site );
		/* translators: PHP runtime option, paired with "Sandbox". The compiled PHP binary that Studio bundles and runs natively on the machine. */
		const nativeLabel = __( 'Native' );
		/* translators: PHP runtime option, paired with "Native". Runs the site in an isolated WordPress Playground sandbox. */
		const sandboxLabel = __( 'Sandbox' );
		const runtimeLabel = runtime === SITE_RUNTIME_NATIVE_PHP ? nativeLabel : sandboxLabel;
		const fileAccessLabel =
			/* translators: value for the File access setting in the site status output */
			fileAccess === SITE_FILE_ACCESS_ALL_FILES ? __( 'All files' ) : __( 'Site directory' );

		const siteData: {
			key: string;
			jsonKey: string;
			value: string | undefined;
			type?: string;
			hidden?: boolean;
			secret?: boolean;
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
			{ key: __( 'Status' ), jsonKey: 'status', value: status },
			{ key: __( 'PHP version' ), jsonKey: 'phpVersion', value: site.phpVersion },
			{ key: __( 'PHP runtime' ), jsonKey: 'runtime', value: runtimeLabel },
			{ key: __( 'File access' ), jsonKey: 'fileAccess', value: fileAccessLabel },
			{ key: __( 'WP version' ), jsonKey: 'wpVersion', value: wpVersion },
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
				secret: true,
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
				siteData
					.filter( ( { secret } ) => ! secret )
					.flatMap( ( { jsonKey, value } ) =>
						jsonKey === 'status'
							? [
									[ jsonKey, value ],
									[ 'isOnline', isOnline ],
							  ]
							: [ [ jsonKey, value ] ]
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
