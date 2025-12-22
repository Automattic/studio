import { __, _n } from '@wordpress/i18n';
import { getDomainNameValidationError } from 'common/lib/domains';
import { arePathsEqual } from 'common/lib/fs-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	lockAppdata,
	readAppdata,
	saveAppdata,
	SiteData,
	unlockAppdata,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { setupCustomDomain } from 'cli/lib/site-utils';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( sitePath: string, domainName: string ): Promise< void > {
	try {
		let site: SiteData;
		let oldDomainName: string | undefined;

		try {
			await lockAppdata();
			const appdata = await readAppdata();

			const foundSite = appdata.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
			if ( ! foundSite ) {
				throw new LoggerError( __( 'The specified folder is not added to Studio.' ) );
			}

			site = foundSite;
			const existingDomainNames = appdata.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError( true, domainName, existingDomainNames );

			if ( domainError ) {
				throw new LoggerError( domainError );
			}

			oldDomainName = site.customDomain;

			if ( oldDomainName === domainName ) {
				throw new LoggerError( __( 'The specified domain is already set for this site.' ) );
			}

			site.customDomain = domainName;
			await saveAppdata( appdata );
		} finally {
			await unlockAppdata();
		}

		if ( oldDomainName ) {
			logger.reportStart(
				LoggerAction.REMOVE_DOMAIN_FROM_HOSTS,
				__( 'Removing domain from hosts file…' )
			);
			await removeDomainFromHosts( oldDomainName );
			logger.reportSuccess( __( 'Domain removed from hosts file' ) );
		}

		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connect();
		logger.reportSuccess( __( 'Process daemon started' ) );

		const runningProcess = await isServerRunning( site.id );

		if ( runningProcess ) {
			await stopWordPressServer( site.id );
			await setupCustomDomain( site, logger );
			logger.reportStart( LoggerAction.START_SITE, __( 'Restarting site…' ) );
			const processDesc = await startWordPressServer( site, logger );
			if ( processDesc.pid ) {
				await updateSiteLatestCliPid( site.id, processDesc.pid );
			}
			logger.reportSuccess( __( 'Site restarted' ) );
		}
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'set-domain <domain>',
		describe: __( 'Set domain for a local site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'domain', {
				type: 'string',
				description: __( 'Domain name' ),
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.domain );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to configure site domain' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
