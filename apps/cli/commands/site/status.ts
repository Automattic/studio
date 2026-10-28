import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { decodePassword } from '@studio/common/lib/passwords';
import { getSiteFileAccess, SITE_FILE_ACCESS_ALL_FILES } from '@studio/common/lib/site-file-access';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getSiteEmailDirectory } from 'cli/lib/site-email';
import { getPrettyPath } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import type { SiteStatus } from '@studio/common/types/site-status';
import type { builder } from 'cli/commands/site/status.command';
import type { CommandArgs } from 'cli/types';

const logger = new Logger< LoggerAction >();

// The site's details. Callers connect to the daemon first.
export async function getSiteStatus( site: SiteData ): Promise< SiteStatus > {
	const running = Boolean( await isServerRunning( site.id ) );
	const url = new URL( getSiteUrl( site ) ).toString();
	const autoLoginUrl = new URL( url );
	autoLoginUrl.pathname = `/studio-auto-login`;
	autoLoginUrl.searchParams.set( 'redirect_to', `/wp-admin/` );
	return {
		url,
		...( running ? { autoLoginUrl: autoLoginUrl.toString() } : {} ),
		path: site.path,
		emailPath: getSiteEmailDirectory( site.id ),
		running,
		phpVersion: site.phpVersion,
		wpVersion: getWordPressVersion( site.path ),
		fileAccess: getSiteFileAccess( site ),
		xdebug: Boolean( site.enableXdebug ),
		adminUsername: site.adminUsername ?? 'admin',
		adminEmail: site.adminEmail,
	};
}

export async function runCommand( siteFolder: string, format: 'table' | 'json' ): Promise< void > {
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		const siteStatus = await getSiteStatus( site );
		const isOnline = siteStatus.running;
		const status = isOnline ? `🟢 ${ __( 'Online' ) }` : `🔴 ${ __( 'Offline' ) }`;
		const sitePath = getPrettyPath( siteStatus.path );
		const wpVersion = siteStatus.wpVersion;

		/* translators: status value for the Xdebug setting in the site status output */
		const xdebugStatus = siteStatus.xdebug ? __( 'Enabled' ) : __( 'Disabled' );

		const fileAccessLabel =
			/* translators: value for the File access setting in the site status output */
			siteStatus.fileAccess === SITE_FILE_ACCESS_ALL_FILES
				? __( 'All files' )
				: __( 'Site directory' );

		const siteData: {
			key: string;
			jsonKey: string;
			value: string | undefined;
			type?: string;
			secret?: boolean;
		}[] = [
			{
				key: __( 'Site URL' ),
				jsonKey: 'siteUrl',
				value: siteStatus.url,
				type: 'url',
			},
			{
				key: __( 'Auto-login URL' ),
				jsonKey: 'autoLoginUrl',
				value: siteStatus.autoLoginUrl,
				type: 'url',
			},
			{ key: __( 'Site Path' ), jsonKey: 'sitePath', value: sitePath },
			{
				key: __( 'Email' ),
				jsonKey: 'emailPath',
				value: getPrettyPath( siteStatus.emailPath ),
			},
			{ key: __( 'Status' ), jsonKey: 'status', value: status },
			{ key: __( 'PHP version' ), jsonKey: 'phpVersion', value: siteStatus.phpVersion },
			{ key: __( 'File access' ), jsonKey: 'fileAccess', value: fileAccessLabel },
			{ key: __( 'WP version' ), jsonKey: 'wpVersion', value: wpVersion },
			{ key: __( 'Xdebug' ), jsonKey: 'xdebug', value: xdebugStatus },
			{
				key: __( 'Admin username' ),
				jsonKey: 'adminUsername',
				value: siteStatus.adminUsername,
			},
			{
				key: __( 'Admin password' ),
				jsonKey: 'adminPassword',
				value: site.adminPassword ? decodePassword( site.adminPassword ) : undefined,
				secret: true,
			},
			{ key: __( 'Admin email' ), jsonKey: 'adminEmail', value: siteStatus.adminEmail },
		].filter( ( { value } ) => value );

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
export async function commandHandler( argv: CommandArgs< typeof builder > ) {
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
}
