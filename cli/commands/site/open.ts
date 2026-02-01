import { __ } from '@wordpress/i18n';
import open from 'open';
import { getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isServerRunning, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger();

export async function runCommand(
	sitePath: string,
	urlPath: string = '',
	autoLogin: boolean = true
): Promise< void > {
	try {
		logger.reportStart( undefined, __( 'Loading site…' ) );
		const site = await getSiteByFolder( sitePath );
		logger.reportSuccess( __( 'Site loaded' ) );

		logger.reportStart( undefined, __( 'Checking site status…' ) );
		await connect();
		const isRunning = await isServerRunning( site.id );

		if ( ! isRunning ) {
			logger.reportStart( undefined, __( 'Starting WordPress server…' ) );
			await startWordPressServer( site, logger );
			logger.reportSuccess( __( 'WordPress server started' ) );
		} else {
			logger.reportSuccess( __( 'Site is running' ) );
		}

		// Construct URL
		const protocol = site.customDomain && site.enableHttps ? 'https' : 'http';
		const domain = site.customDomain || `localhost:${ site.port }`;
		let url = `${ protocol }://${ domain }${ urlPath }`;

		// Add auto-login if enabled
		if ( autoLogin ) {
			const autoLoginUrl = `${ protocol }://${ domain }/studio-auto-login?redirect_to=${ encodeURIComponent(
				url
			) }`;
			url = autoLoginUrl;
		}

		logger.reportStart( undefined, __( 'Opening in browser…' ) );
		await open( url );
		logger.reportSuccess( __( 'Browser opened' ) );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to open site' ), error );
	} finally {
		await disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'open [url-path]',
		describe: __( 'Open site in browser (starts site if needed)' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'url-path', {
					describe: __( 'Path to open (e.g., /wp-admin, /my-page)' ),
					type: 'string',
					default: '',
				} )
				.option( 'no-login', {
					describe: __( 'Skip auto-login' ),
					type: 'boolean',
					default: false,
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, ( argv[ 'url-path' ] as string ) || '', ! argv[ 'no-login' ] );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to open site' ), error ) );
				}
				process.exit( 1 );
			}
		},
	} );
};
