import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SupportedPHPVersions } from '@php-wasm/universal';
import { __, sprintf } from '@wordpress/i18n';
import { Blueprint, StepDefinition } from '@wp-playground/blueprints';
import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	MINIMUM_WORDPRESS_VERSION,
} from 'common/constants';
import {
	filterUnsupportedBlueprintFeatures,
	validateBlueprintData,
} from 'common/lib/blueprint-validation';
import { getDomainNameValidationError } from 'common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from 'common/lib/fs-utils';
import { DEFAULT_LOCALE } from 'common/lib/locale';
import { isOnline } from 'common/lib/network-utils';
import { createPassword } from 'common/lib/passwords';
import { portFinder } from 'common/lib/port-finder';
import { SITE_EVENTS } from 'common/lib/site-events';
import { sortSites } from 'common/lib/sort-sites';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from 'common/lib/wordpress-version-utils';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import {
	lockAppdata,
	readAppdata,
	removeSiteFromAppdata,
	saveAppdata,
	SiteData,
	unlockAppdata,
	updateSiteAutoStart,
	updateSiteLatestCliPid,
} from 'cli/lib/appdata';
import { connect, disconnect, emitSiteEvent } from 'cli/lib/pm2-manager';
import { getServerFilesPath } from 'cli/lib/server-files';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { installSqliteIntegration, isSqliteIntegrationAvailable } from 'cli/lib/sqlite-integration';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const ALLOWED_PHP_VERSIONS = [ ...SupportedPHPVersions ];

const logger = new Logger< LoggerAction >();

type CreateCommandOptions = {
	name?: string;
	wpVersion: string;
	phpVersion: ( typeof ALLOWED_PHP_VERSIONS )[ number ];
	customDomain?: string;
	enableHttps: boolean;
	blueprint?: {
		contents: unknown;
		uri: string;
	};
	noStart: boolean;
	skipBrowser: boolean;
	skipLogDetails: boolean;
};

export async function runCommand(
	sitePath: string,
	options: CreateCommandOptions
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration…' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		let blueprintUri: string | undefined;
		let blueprint: Blueprint | undefined;

		if ( options.blueprint ) {
			const validation = await validateBlueprintData( options.blueprint.contents );
			if ( ! validation.valid ) {
				throw new LoggerError( validation.error );
			}

			for ( const warning of validation.warnings ) {
				logger.reportWarning(
					sprintf(
						/* translators: %1$s: feature name, %2$s: reason */
						__( `Blueprint feature "%1$s" is not supported: %2$s` ),
						warning.feature,
						warning.reason
					)
				);
			}

			blueprintUri = options.blueprint.uri;
			blueprint = filterUnsupportedBlueprintFeatures(
				options.blueprint.contents as Record< string, unknown >
			);
		}

		const appdata = await readAppdata();
		if ( appdata.sites.some( ( site ) => arePathsEqual( site.path, sitePath ) ) ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of appdata.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = appdata.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError(
				true,
				options.customDomain,
				existingDomains
			);
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory…' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		const isOnlineStatus = await isOnline();

		if ( options.wpVersion === 'latest' ) {
			const bundledWPPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );

			if ( ! ( await pathExists( bundledWPPath ) ) ) {
				throw new LoggerError(
					__(
						'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.'
					)
				);
			}

			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await recursiveCopyDirectory( bundledWPPath, sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		} else if ( ! isOnlineStatus ) {
			throw new LoggerError(
				__(
					'Cannot set up WordPress while offline. Specific WordPress versions require an internet connection. Try using "latest" version or ensure internet connectivity.'
				)
			);
		}

		if ( ! ( await isSqliteIntegrationAvailable() ) ) {
			throw new LoggerError(
				__(
					'SQLite integration files not found. Please ensure Studio is installed and has been run at least once.'
				)
			);
		}
		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		await installSqliteIntegration( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port…' ) );
		const port = await portFinder.getOpenPort();
		// translators: %d is the port number
		logger.reportSuccess( sprintf( __( 'Port assigned: %d' ), port ) );

		const siteName = options.name || path.basename( sitePath );
		const siteId = crypto.randomUUID();
		const adminPassword = createPassword();

		const setupSteps: StepDefinition[] = [];

		if ( isOnlineStatus ) {
			const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

			if ( siteLanguage && siteLanguage !== DEFAULT_LOCALE ) {
				setupSteps.push(
					{
						step: 'setSiteLanguage',
						language: siteLanguage,
					},
					{
						step: 'setSiteOptions',
						options: {
							WPLANG: siteLanguage,
						},
					}
				);
			}
		}

		if ( options.name ) {
			setupSteps.push( {
				step: 'setSiteOptions',
				options: {
					blogname: options.name,
				},
			} );
		}

		if ( setupSteps.length > 0 ) {
			if ( ! blueprint ) {
				blueprint = {};
				// Since we know the user didn't supply a blueprint, we create an empty directory to use as a
				// fake location for the `blueprintUri`
				const blueprintDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-empty-blueprint-' ) );
				blueprintUri = path.join( blueprintDir, 'blueprint.json' );
			}
			const existingSteps = blueprint.steps || [];
			blueprint.steps = [ ...setupSteps, ...existingSteps ];
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminPassword,
			port,
			phpVersion: options.phpVersion,
			running: false,
			isWpAutoUpdating: options.wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site…' ) );

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
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
			await connect();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress server and applying Blueprint…' )
				: __( 'Starting WordPress server…' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				const processDesc = await startWordPressServer( siteDetails, logger, {
					wpVersion: options.wpVersion,
					blueprint,
					blueprintUri,
				} );
				logger.reportSuccess( __( 'WordPress server started' ) );

				if ( processDesc.pid ) {
					await updateSiteLatestCliPid( siteDetails.id, processDesc.pid );
				}
				await updateSiteAutoStart( siteDetails.id, true );

				siteDetails.running = true;
				siteDetails.url = siteDetails.customDomain
					? `${ siteDetails.enableHttps ? 'https' : 'http' }://${ siteDetails.customDomain }`
					: `http://localhost:${ siteDetails.port }`;

				if ( ! options.skipLogDetails ) {
					logSiteDetails( siteDetails );
				}
				if ( ! options.skipBrowser ) {
					await openSiteInBrowser( siteDetails );
				}
			} catch ( error ) {
				await removeSiteFromAppdata( siteDetails.id );
				if ( ! isWordPressDirResult ) {
					await fs.promises.rm( sitePath, { recursive: true, force: true } );
				}
				throw new LoggerError( __( 'Failed to start WordPress server' ), error );
			}
		} else {
			if ( blueprint ) {
				logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
				await connect();
				logger.reportSuccess( __( 'Process daemon started' ) );

				logger.reportStart( LoggerAction.START_SITE, __( 'Applying Blueprint…' ) );
				try {
					await runBlueprint( siteDetails, logger, {
						wpVersion: options.wpVersion,
						blueprint,
						blueprintUri: blueprintUri as string,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );
				} catch ( error ) {
					await removeSiteFromAppdata( siteDetails.id );
					if ( ! isWordPressDirResult ) {
						await fs.promises.rm( sitePath, { recursive: true, force: true } );
					}
					throw new LoggerError( __( 'Failed to apply Blueprint' ), error );
				}
			}
			console.log( '' );
			console.log( __( 'Site created successfully' ) );
			console.log( '' );
			if ( ! options.skipLogDetails ) {
				logSiteDetails( siteDetails );
			}
			console.log( __( 'Run "studio site start" to start the site.' ) );
		}

		logger.reportKeyValuePair( 'id', siteDetails.id );
		logger.reportKeyValuePair( 'running', String( siteDetails.running ) );
		await emitSiteEvent( SITE_EVENTS.CREATED, { siteId: siteDetails.id } );
	} finally {
		await disconnect();
	}
}

async function fetchBlueprint( url: string ) {
	const res = await fetch( url );

	if ( ! res.ok ) {
		throw new LoggerError( __( 'Failed to fetch Blueprint' ) );
	}

	try {
		return await res.json();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to parse Blueprint JSON' ), error );
	}
}

function readBlueprint( blueprintPath: string ) {
	if ( ! fs.existsSync( blueprintPath ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), blueprintPath ) );
	}

	try {
		const blueprintContent = fs.readFileSync( blueprintPath, 'utf-8' );
		return JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse Blueprint JSON file: %s' ), blueprintPath ),
			error
		);
	}
}

function coerceWpVersion( value: string ) {
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
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					default: DEFAULT_WORDPRESS_VERSION,
					coerce: coerceWpVersion,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: ALLOWED_PHP_VERSIONS,
					default: DEFAULT_PHP_VERSION,
				} )
				.option( 'domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					implies: 'domain',
				} )
				.option( 'blueprint', {
					type: 'string',
					describe: __( 'Path or URL to Blueprint JSON file' ),
				} )
				.option( 'start', {
					type: 'boolean',
					describe: __( 'Start the site after creation' ),
					default: true,
				} )
				.option( 'skip-browser', {
					type: 'boolean',
					describe: __( 'Skip opening the site in browser after starting' ),
					default: false,
				} )
				.option( 'skip-log-details', {
					type: 'boolean',
					describe: __( 'Skip logging default wp-admin user details after starting' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			const config: CreateCommandOptions = {
				name: argv.name,
				wpVersion: argv.wp,
				phpVersion: argv.php,
				customDomain: argv.domain,
				enableHttps: !! argv.https,
				noStart: ! argv.start,
				skipBrowser: !! argv.skipBrowser,
				skipLogDetails: !! argv.skipLogDetails,
			};

			if ( argv.blueprint ) {
				if ( argv.blueprint.startsWith( 'http://' ) || argv.blueprint.startsWith( 'https://' ) ) {
					config.blueprint = {
						uri: argv.blueprint,
						contents: await fetchBlueprint( argv.blueprint ),
					};
				} else {
					const uri = path.resolve( untildify( argv.blueprint ) );

					config.blueprint = {
						uri,
						contents: readBlueprint( uri ),
					};
				}
			}

			try {
				await runCommand( argv.path, config );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to create site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
