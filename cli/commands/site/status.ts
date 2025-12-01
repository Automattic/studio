import { __, _n } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { getPrettyPath } from 'cli/lib/utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( siteFolder: string, format: 'table' | 'json' ): Promise< void > {
	try {
		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder, false );
		logger.reportSuccess( __( 'Site loaded' ) );

		await connect();

		const isOnline = Boolean( await isServerRunning( site.id ) );
		const status = isOnline ? `🟢 ${ __( 'Online' ) }` : `🔴 ${ __( 'Offline' ) }`;
		const siteUrl = getSiteUrl( site );
		const sitePath = getPrettyPath( site.path );
		const wpVersion = getWordPressVersion( site.path );
		const autoLoginUrl = new URL( siteUrl );
		autoLoginUrl.pathname = `/studio-auto-login`;
		autoLoginUrl.searchParams.set( 'redirect_to', `/wp-admin/` );

		const siteData: {
			key: string;
			value: string | undefined;
			type?: string;
			hidden?: boolean;
		}[] = [
			{ key: __( 'Site URL' ), value: new URL( siteUrl ).toString(), type: 'url' },
			{
				key: __( 'Auto Login URL' ),
				value: autoLoginUrl.toString(),
				type: 'url',
				hidden: ! isOnline,
			},
			{ key: __( 'Site Path' ), value: sitePath },
			{ key: __( 'Status' ), value: status },
			{ key: __( 'PHP Version' ), value: site.phpVersion },
			{ key: __( 'WP Version' ), value: wpVersion },
			{ key: __( 'Admin Username' ), value: 'admin' },
			{ key: __( 'Admin Password' ), value: site.adminPassword },
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
			const logData = Object.fromEntries( siteData.map( ( { key, value } ) => [ key, value ] ) );

			console.log( JSON.stringify( logData, null, 2 ) );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status',
		describe: __( 'Get status of local site' ),
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
					const loggerError = new LoggerError( __( 'Failed to load site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
