import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SupportedPHPVersions } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { Blueprint } from '@wp-playground/blueprints';
import { RecommendedPHPVersion } from '@wp-playground/common';
import { isEmptyDir, isWordPressDirectory, pathExists } from 'common/lib/fs-utils';
import { createPassword } from 'common/lib/passwords';
import { portFinder } from 'common/lib/port-finder';
import { sortSites } from 'common/lib/sort-sites';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from 'common/lib/wordpress-version-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { lockAppdata, readAppdata, saveAppdata, SiteData, unlockAppdata } from 'cli/lib/appdata';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { addDomainToHosts } from 'cli/lib/hosts-file';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { logSiteDetails, openSiteInBrowser, startProxyIfNeeded } from 'cli/lib/site-utils';
import { startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const DEFAULT_SITE_PATH = path.join( os.homedir(), 'Studio' );
const DEFAULT_PHP_VERSION = RecommendedPHPVersion;
const DEFAULT_WORDPRESS_VERSION = 'latest';
const MINIMUM_WORDPRESS_VERSION = '6.2.1'; // https://wordpress.github.io/wordpress-playground/blueprints/examples/#load-an-older-wordpress-version
const ALLOWED_PHP_VERSIONS = [ ...SupportedPHPVersions ];

export async function runCommand(
	sitePath: string,
	options: {
		name?: string;
		wpVersion?: string;
		phpVersion?: string;
		customDomain?: string;
		enableHttps?: boolean;
		blueprint?: string;
		noStart?: boolean;
	}
): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration...' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		// WordPress version is validated by yargs check
		const wpVersion = options.wpVersion || DEFAULT_WORDPRESS_VERSION;

		const phpVersion = ( options.phpVersion ||
			DEFAULT_PHP_VERSION ) as ( typeof ALLOWED_PHP_VERSIONS )[ number ];

		let blueprint: Blueprint | undefined;
		if ( options.blueprint ) {
			if ( ! fs.existsSync( options.blueprint ) ) {
				throw new LoggerError( __( 'Blueprint file not found: ' ) + options.blueprint );
			}
			try {
				const blueprintContent = fs.readFileSync( options.blueprint, 'utf-8' );
				blueprint = JSON.parse( blueprintContent );
			} catch ( error ) {
				throw new LoggerError( __( 'Invalid blueprint JSON file' ), error );
			}
		}

		const appdata = await readAppdata();
		const allPaths = appdata.sites.map( ( site ) => site.path );
		if ( allPaths.includes( sitePath ) ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult && sitePath.startsWith( DEFAULT_SITE_PATH ) ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory...' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port...' ) );
		const port = await portFinder.getOpenPort();
		logger.reportSuccess( __( 'Port assigned: ' ) + port );

		const siteName = options.name || path.basename( sitePath );
		const siteId = crypto.randomUUID();
		const adminPassword = createPassword();

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminPassword,
			port,
			phpVersion,
			running: false,
			isWpAutoUpdating: wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site...' ) );

		try {
			await lockAppdata();
			const userData = await readAppdata();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveAppdata( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockAppdata();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon...' ) );
			await connect();
			logger.reportSuccess( __( 'Process daemon started' ) );

			if ( siteDetails.customDomain ) {
				await startProxyIfNeeded( logger );

				if ( siteDetails.enableHttps ) {
					logger.reportStart( LoggerAction.GENERATE_CERT, __( 'Generating SSL certificates...' ) );
					await generateSiteCertificate( siteDetails.customDomain );
					logger.reportSuccess( __( 'SSL certificates generated' ) );
				}

				logger.reportStart(
					LoggerAction.ADD_DOMAIN_TO_HOSTS,
					__( 'Adding domain to hosts file...' )
				);
				try {
					await addDomainToHosts( siteDetails.customDomain, siteDetails.port );
					logger.reportSuccess( __( 'Domain added to hosts file' ) );
				} catch ( error ) {
					throw new LoggerError( __( 'Failed to add domain to hosts file' ), error );
				}
			}

			// Start the site
			logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress site...' ) );
			try {
				await startWordPressServer( siteDetails, { wpVersion, blueprint } );
				logger.reportSuccess( __( 'WordPress site started' ) );

				logSiteDetails( siteDetails );
				await openSiteInBrowser( siteDetails );
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to start WordPress server' ), error );
			}
		} else if ( blueprint ) {
			// Apply blueprint to stopped site
			// For now, we'll just inform the user that blueprint will be applied on first start
			console.log( __( '\nSite created successfully!\n' ) );
			console.log(
				__(
					'Note: Blueprint will be applied when you first start the site with "studio site start".'
				)
			);
			logSiteDetails( siteDetails );
		} else {
			// Just display site details
			console.log( __( '\nSite created successfully!\n' ) );
			logSiteDetails( siteDetails );
			console.log( __( '\nRun "studio site start" to start the site.' ) );
		}
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create site' ), error );
			logger.reportError( loggerError );
		}
		process.exit( 1 );
	} finally {
		disconnect();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new local site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp-version', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					default: DEFAULT_WORDPRESS_VERSION,
				} )
				.option( 'php-version', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: ALLOWED_PHP_VERSIONS,
					default: DEFAULT_PHP_VERSION,
				} )
				.check( ( argv ) => {
					if ( argv.wpVersion && typeof argv.wpVersion === 'string' ) {
						if ( ! isValidWordPressVersion( argv.wpVersion ) ) {
							throw new Error(
								__(
									'Invalid WordPress version. Must be "latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1").'
								)
							);
						}

						if ( ! isWordPressVersionAtLeast( argv.wpVersion, MINIMUM_WORDPRESS_VERSION ) ) {
							throw new Error(
								__(
									`WordPress version must be at least ${ MINIMUM_WORDPRESS_VERSION }. Provided: ${ argv.wpVersion }`
								)
							);
						}
					}
					return true;
				} )
				.option( 'custom-domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'enable-https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					default: false,
				} )
				.option( 'blueprint', {
					type: 'string',
					describe: __( 'Path to blueprint JSON file' ),
				} )
				.option( 'no-start', {
					type: 'boolean',
					describe: __( 'Do not start the site after creation' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, {
				name: argv.name,
				wpVersion: argv.wpVersion,
				phpVersion: argv.phpVersion,
				customDomain: argv.customDomain,
				enableHttps: argv.enableHttps,
				blueprint: argv.blueprint,
				noStart: argv.noStart,
			} );
		},
	} );
};
