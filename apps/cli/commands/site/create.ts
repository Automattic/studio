import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { confirm, input, select } from '@inquirer/prompts';
import { SupportedPHPVersions } from '@php-wasm/universal';
import {
	DEFAULT_PHP_VERSION,
	DEFAULT_WORDPRESS_VERSION,
	MINIMUM_WORDPRESS_VERSION,
} from '@studio/common/constants';
import {
	blueprintHasMultisite,
	extractFormValuesFromBlueprint,
} from '@studio/common/lib/blueprint-settings';
import {
	filterUnsupportedBlueprintFeatures,
	validateBlueprintData,
} from '@studio/common/lib/blueprint-validation';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { isOnline } from '@studio/common/lib/network-utils';
import {
	createPassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import { SITE_EVENTS } from '@studio/common/lib/site-events';
import { sortSites } from '@studio/common/lib/sort-sites';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { Blueprint, BlueprintV1Declaration, StepDefinition } from '@wp-playground/blueprints';
import { writeAgentsMd } from 'cli/lib/agents-md';
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
import { generateSiteName, getDefaultSitePath } from 'cli/lib/generate-site-name';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { connect, disconnect, emitSiteEvent } from 'cli/lib/pm2-manager';
import { getServerFilesPath } from 'cli/lib/server-files';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const ALLOWED_PHP_VERSIONS = [ ...SupportedPHPVersions ];

const logger = new Logger< LoggerAction >();

type CreateCommandOptions = {
	name?: string;
	siteId?: string;
	wpVersion: string;
	phpVersion: ( typeof ALLOWED_PHP_VERSIONS )[ number ];
	customDomain?: string;
	enableHttps: boolean;
	blueprint?: {
		contents: unknown;
		uri: string;
	};
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
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
		let blueprint: BlueprintV1Declaration | undefined;
		let blueprintCredentials: { adminUsername?: string; adminPassword?: string } | null = null;

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

			// Extract login credentials from blueprint before filtering
			const formValues = extractFormValuesFromBlueprint(
				// `validateBlueprintData()` does not give us a proper type guard, but in reality, it ensures
				// `options.blueprint.contents` conforms to the `BlueprintV1Declaration` schema.
				options.blueprint.contents as BlueprintV1Declaration
			);
			if ( formValues.adminUsername || formValues.adminPassword ) {
				blueprintCredentials = {
					adminUsername: formValues.adminUsername,
					adminPassword: formValues.adminPassword,
				};
			}

			blueprintUri = options.blueprint.uri;
			blueprint = filterUnsupportedBlueprintFeatures(
				options.blueprint.contents as BlueprintV1Declaration
			);

			if ( blueprint && blueprintHasMultisite( blueprint ) && ! options.customDomain ) {
				throw new LoggerError(
					__(
						'The enableMultisite Blueprint step requires a custom domain. WordPress multisite does not support custom ports. Use --domain <name>.local to set a custom domain.'
					)
				);
			}
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

		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		const isSqliteUpdated = await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess(
			isSqliteUpdated ? __( 'SQLite integration configured' ) : __( 'SQLite integration skipped' )
		);

		try {
			await writeAgentsMd( sitePath );
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to write AGENTS.md. Proceeding anyway…' ), error ),
				false
			);
		}

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port…' ) );
		const port = await portFinder.getOpenPort();
		// translators: %d is the port number
		logger.reportSuccess( sprintf( __( 'Port assigned: %d' ), port ) );

		const siteName = options.name || path.basename( sitePath );
		const siteId = options.siteId || crypto.randomUUID();

		// Determine admin credentials: CLI args > Blueprint > defaults
		// External passwords need to be encoded; createPassword() already returns encoded
		const adminUsername = options.adminUsername || blueprintCredentials?.adminUsername || undefined;
		if ( adminUsername ) {
			const usernameError = validateAdminUsername( adminUsername );
			if ( usernameError ) {
				throw new LoggerError( usernameError );
			}
		}
		const adminEmail = options.adminEmail?.trim() || undefined;
		if ( adminEmail ) {
			const emailError = validateAdminEmail( adminEmail );
			if ( emailError ) {
				throw new LoggerError( emailError );
			}
		}

		const externalPassword = options.adminPassword || blueprintCredentials?.adminPassword;
		const adminPassword = externalPassword ? encodePassword( externalPassword ) : createPassword();

		const setupSteps: StepDefinition[] = [];

		const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

		if ( siteLanguage && siteLanguage !== DEFAULT_LOCALE ) {
			// For the 'latest' WP version, try using bundled language packs first to avoid
			// a network round-trip. Fall back to the Playground setSiteLanguage step for
			// non-latest versions or when bundled packs aren't available.
			let isUsingBundledLanguagePacks = false;
			if ( options.wpVersion === DEFAULT_WORDPRESS_VERSION ) {
				isUsingBundledLanguagePacks = await copyLanguagePackToSite( sitePath, siteLanguage );
			}

			if ( isUsingBundledLanguagePacks ) {
				setupSteps.push(
					{
						step: 'defineWpConfigConsts',
						consts: {
							WPLANG: siteLanguage,
						},
					},
					{
						step: 'setSiteOptions',
						options: {
							WPLANG: siteLanguage,
						},
					}
				);
			} else if ( isOnlineStatus ) {
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

		const hasWpConfig = await pathExists( path.join( sitePath, 'wp-config.php' ) );
		const isWordPressDirectoryInitialized = isWordPressDirResult && hasWpConfig;
		if ( options.name && ! isWordPressDirectoryInitialized ) {
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
			const existingSteps = Array.isArray( blueprint.steps ) ? blueprint.steps : [];
			blueprint = { ...blueprint, steps: [ ...setupSteps, ...existingSteps ] };
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminUsername,
			adminPassword,
			adminEmail,
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

				stripWpConfigDbConstants( sitePath );

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
					if ( ! blueprintUri ) {
						throw new LoggerError( __( 'Blueprint source path is missing' ) );
					}
					await runBlueprint( siteDetails, logger, {
						wpVersion: options.wpVersion,
						blueprint,
						blueprintUri,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );

					stripWpConfigDbConstants( sitePath );
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

function stripWpConfigDbConstants( sitePath: string ): void {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}
	const content = fs.readFileSync( wpConfigPath, 'utf-8' );
	if ( hasDefaultDbBlock( content ) ) {
		fs.writeFileSync( wpConfigPath, removeDbConstants( content ), 'utf-8' );
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

function coerceSiteId( value: string ) {
	// Validate UUID format (8-4-4-4-12 hex characters)
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if ( ! uuidRegex.test( value ) ) {
		throw new ValidationError( 'id', value, __( 'Must be a valid UUID' ) );
	}
	return value;
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
				.option( 'id', {
					type: 'string',
					describe: __( 'Site ID (UUID format, used internally by Studio app)' ),
					hidden: true,
					coerce: coerceSiteId,
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					defaultDescription: DEFAULT_WORDPRESS_VERSION,
					coerce: coerceWpVersion,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: ALLOWED_PHP_VERSIONS,
					defaultDescription: DEFAULT_PHP_VERSION,
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
				.option( 'admin-username', {
					type: 'string',
					describe: __( 'Admin username (defaults to "admin")' ),
				} )
				.option( 'admin-password', {
					type: 'string',
					describe: __(
						'Admin password (auto-generated if not provided). Note: passwords in CLI arguments may be visible in process lists; consider using a Blueprint file for sensitive passwords.'
					),
				} )
				.option( 'admin-email', {
					type: 'string',
					describe: __( 'Admin email (defaults to "admin@localhost.com")' ),
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
					describe: __( 'Skip printing site URL and admin credentials after creating' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			let siteName = argv.name;
			let sitePath = argv.path;
			let wpVersion = argv.wp;
			let phpVersion = argv.php;
			let customDomain = argv.domain;
			let enableHttps = !! argv.https;

			try {
				if ( process.stdin.isTTY ) {
					if ( ! siteName ) {
						const defaultName = await generateSiteName();
						siteName = await input( {
							message: __( 'Site name:' ),
							default: defaultName,
						} );
					}

					const pathWasExplicitlyProvided = sitePath !== process.cwd();
					if ( ! pathWasExplicitlyProvided ) {
						const suggestedPath = getDefaultSitePath( siteName || __( 'My WordPress Website' ) );
						const promptedPath = await input( {
							message: __( 'Site path:' ),
							default: suggestedPath,
						} );
						sitePath = path.resolve( untildify( promptedPath ) );
					}

					if ( ! wpVersion ) {
						let wpChoices: { name: string; value: string }[];
						try {
							const versions = await fetchWordPressVersions();
							wpChoices = versions.map( ( v ) => ( {
								name: v.value === 'latest' ? `latest (${ v.label })` : v.label,
								value: v.value,
							} ) );
						} catch {
							// Offline or API failure — offer only "latest"
							wpChoices = [
								{
									name: sprintf( __( '%s (recommended)' ), __( 'Latest' ) ),
									value: 'latest',
								},
							];
						}
						wpVersion = await select( {
							message: __( 'WordPress version:' ),
							choices: wpChoices,
							default: DEFAULT_WORDPRESS_VERSION,
							loop: false,
						} );
					}

					if ( ! phpVersion ) {
						phpVersion = await select( {
							message: __( 'PHP version:' ),
							choices: ALLOWED_PHP_VERSIONS.map( ( v ) => ( {
								name: v === DEFAULT_PHP_VERSION ? sprintf( __( '%s (recommended)' ), v ) : v,
								value: v,
							} ) ),
							default: DEFAULT_PHP_VERSION,
						} );
					}

					if ( ! customDomain ) {
						const appdata = await readAppdata();
						const existingDomains = appdata.sites
							.map( ( site ) => site.customDomain )
							.filter( ( domain ): domain is string => Boolean( domain ) );

						customDomain = await input( {
							message: __( 'Custom domain (leave empty to skip):' ),
							validate: ( value ) =>
								getDomainNameValidationError( !! value, value, existingDomains ) || true,
						} );
					}

					if ( customDomain && ! argv.https ) {
						enableHttps = await confirm( {
							message: __( 'Enable HTTPS?' ),
							default: false,
						} );
					}
				}
			} catch {
				// User cancelled the prompt (Ctrl+C)
				return;
			}

			// Apply defaults for non-interactive mode when flags weren't provided
			wpVersion = wpVersion ?? DEFAULT_WORDPRESS_VERSION;
			phpVersion = phpVersion ?? DEFAULT_PHP_VERSION;

			const config: CreateCommandOptions = {
				name: siteName,
				siteId: argv.id,
				wpVersion,
				phpVersion,
				customDomain,
				enableHttps,
				adminUsername: argv.adminUsername,
				adminPassword: argv.adminPassword,
				adminEmail: argv.adminEmail,
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
				await runCommand( sitePath, config );
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
