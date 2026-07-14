import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { confirm, input, password, select } from '@inquirer/prompts';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { installAiInstructionsToSite } from '@studio/common/lib/agent-skills';
import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { normalizeLandingPage } from '@studio/common/lib/landing-page';
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
import { readSharedConfig } from '@studio/common/lib/shared-config';
import {
	isFileAccessAllowedForRuntime,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	SITE_MODE_NATIVE,
	SITE_MODE_SANDBOX,
	SITE_RUNTIME_NATIVE_PHP,
	siteRuntimeFromMode,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { sortSites } from '@studio/common/lib/sort-sites';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import {
	RecommendedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { isStepDefinition, type BlueprintV1Declaration } from '@wp-playground/blueprints';
import { bumpStat, getPlatformMetric } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import {
	getAiInstructionsPath,
	getWordPressVersionPath,
} from 'cli/lib/dependency-management/paths';
import { updateServerFiles } from 'cli/lib/dependency-management/setup';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { validateSupportedPhpVersion } from 'cli/lib/php-versions';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { generateSiteName } from 'cli/lib/site-name';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { StatsGroup } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export type CreateCommandOptions = {
	name?: string;
	siteId?: string;
	wpVersion: string;
	phpVersion: SupportedPHPVersion;
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
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
	const siteRuntime = options.runtime;
	if ( ! isFileAccessAllowedForRuntime( siteRuntime, options.fileAccess ) ) {
		throw new LoggerError(
			__(
				'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
			)
		);
	}
	const phpVersion = validateSupportedPhpVersion( options.phpVersion );
	const isOnlineStatus = await isOnline();

	try {
		if ( isOnlineStatus ) {
			const updated = await updateServerFiles();
			if ( updated ) {
				logger.reportSuccess( __( 'Dependencies updated' ) );
			}
		}
	} catch ( error ) {
		// Errors here aren't critical and likely relate to things outside the user's control,
		// like network issues or bad API responses. Report them only in development.
		if ( process.env.NODE_ENV !== 'production' ) {
			const loggerError = new LoggerError( 'Failed to update dependencies', error );
			logger.reportError( loggerError, false );
		}
	}

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

			// `validateBlueprintData()` does not give us a proper type guard, but in reality, it ensures
			// `options.blueprint.contents` conforms to the `BlueprintV1Declaration` schema.
			const formValues = extractFormValuesFromBlueprint(
				options.blueprint.contents as BlueprintV1Declaration
			);
			if ( formValues.adminUsername || formValues.adminPassword ) {
				blueprintCredentials = {
					adminUsername: formValues.adminUsername,
					adminPassword: formValues.adminPassword,
				};
			}

			blueprintUri = options.blueprint.uri;
			blueprint = options.blueprint.contents as BlueprintV1Declaration;

			const blueprintHasMultisite = blueprint?.steps
				?.filter( isStepDefinition )
				.some( ( step ) => step.step === 'enableMultisite' );

			if ( blueprintHasMultisite && ! options.customDomain ) {
				throw new LoggerError(
					__(
						'The enableMultisite Blueprint step requires a custom domain. WordPress multisite does not support custom ports. Use --domain <name>.local to set a custom domain.'
					)
				);
			}
		}

		const cliConfig = await readCliConfig();
		if ( cliConfig.sites.some( ( site ) => arePathsEqual( site.path, sitePath ) ) ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of cliConfig.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = cliConfig.sites
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
		} else if ( siteRuntime === SITE_RUNTIME_NATIVE_PHP && ! isWordPressDirResult ) {
			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Downloading WordPress %s…' ), options.wpVersion )
			);
			await downloadWordPress( options.wpVersion );
			logger.reportSuccess( __( 'WordPress files downloaded' ) );

			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Copying WordPress %s…' ), options.wpVersion )
			);
			await recursiveCopyDirectory( getWordPressVersionPath( options.wpVersion ), sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		try {
			const sharedConfig = await readSharedConfig();
			const selectedSkills = sharedConfig.selectedSkills ?? [];
			await installAiInstructionsToSite(
				{ path: sitePath, runtime: siteRuntime },
				getAiInstructionsPath(),
				selectedSkills
			);
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to install AI instructions. Proceeding anyway…' ), error ),
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

		const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

		if (
			siteLanguage &&
			siteLanguage !== DEFAULT_LOCALE &&
			options.wpVersion === DEFAULT_WORDPRESS_VERSION
		) {
			await copyLanguagePackToSite( sitePath, siteLanguage );
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminUsername,
			adminPassword,
			adminEmail,
			port,
			phpVersion,
			runtime: siteRuntime,
			fileAccess: options.fileAccess,
			running: false,
			status: 'ready',
			isWpAutoUpdating: options.wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
			landingPage: normalizeLandingPage( blueprint?.landingPage ),
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site…' ) );

		try {
			await lockCliConfig();
			const userData = await readCliConfig();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveCliConfig( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockCliConfig();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
			await connectToDaemon();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress server and applying Blueprint…' )
				: __( 'Starting WordPress server…' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				await startWordPressServer( siteDetails, logger, {
					wpVersion: options.wpVersion,
					blueprint,
					blueprintUri,
					siteLanguage,
				} );
				logger.reportSuccess( __( 'WordPress server started' ) );

				stripWpConfigDbConstants( sitePath );

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
				await removeSiteFromConfig( siteDetails.id );
				if ( ! isWordPressDirResult ) {
					await fs.promises.rm( sitePath, { recursive: true, force: true } );
				}
				throw new LoggerError( __( 'Failed to start WordPress server' ), error );
			}
		} else {
			if ( blueprint ) {
				logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
				await connectToDaemon();
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
						siteLanguage,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );

					stripWpConfigDbConstants( sitePath );
				} catch ( error ) {
					await removeSiteFromConfig( siteDetails.id );
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
			console.log( __( 'Run "studio start" to start the site.' ) );
		}

		logger.reportKeyValuePair( 'id', siteDetails.id );
		logger.reportKeyValuePair( 'port', String( siteDetails.port ) );
		logger.reportKeyValuePair( 'running', String( siteDetails.running ) );
		await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: siteDetails.id } } );
	} finally {
		await disconnectFromDaemon();
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
					choices: SupportedPHPVersions,
					defaultDescription: RecommendedPHPVersion,
				} )
				.option( 'runtime', {
					type: 'string',
					describe: __(
						'Run the site with native PHP ("native") or in the Playground sandbox ("sandbox")'
					),
					choices: [ SITE_MODE_NATIVE, SITE_MODE_SANDBOX ] as const,
					default: SITE_MODE_NATIVE,
				} )
				.option( 'file-access', {
					type: 'string',
					describe: __(
						'Which files PHP can access with the native PHP runtime: the site directory only, or all files'
					),
					choices: [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ] as const,
					default: SITE_FILE_ACCESS_SITE_DIRECTORY,
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
				.option( 'original-blueprint-path', {
					type: 'string',
					hidden: true,
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
			let adminUsername = argv.adminUsername;
			let adminPassword = argv.adminPassword;
			let adminEmail = argv.adminEmail;
			const runtime = siteRuntimeFromMode( argv.runtime );
			const fileAccess = argv.fileAccess;
			if ( ! isFileAccessAllowedForRuntime( runtime, fileAccess ) ) {
				logger.reportError(
					new LoggerError(
						__(
							'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
						)
					)
				);
				return;
			}

			// Validate and resolve the WordPress version against available versions before prompting
			if ( wpVersion && wpVersion !== 'latest' && wpVersion !== 'nightly' ) {
				try {
					logger.reportStart( LoggerAction.VALIDATE, __( 'Checking WordPress version…' ) );
					const availableVersions = await fetchWordPressVersions();
					const matchedVersion = availableVersions.find(
						( v ) => v.value === wpVersion || v.value.startsWith( wpVersion + '.' )
					);
					if ( ! matchedVersion ) {
						const versionLabels = availableVersions
							.filter( ( v ) => v.value !== 'latest' )
							.map( ( v ) => v.label );
						logger.reportError(
							new LoggerError(
								sprintf(
									/* translators: %1$s: requested version, %2$s: list of available versions */
									__( 'WordPress version "%1$s" is not available. Available versions: %2$s' ),
									wpVersion,
									versionLabels.join( ', ' )
								)
							)
						);
						return;
					}
					// Resolve short versions to full versions (e.g. "6.7" → "6.7.2")
					if ( matchedVersion.value !== wpVersion ) {
						logger.reportSuccess(
							sprintf(
								/* translators: %1$s: requested version, %2$s: resolved version */
								__( 'WordPress version: %1$s → %2$s' ),
								wpVersion,
								matchedVersion.value
							)
						);
					} else {
						logger.reportSuccess(
							sprintf(
								/* translators: %s: WordPress version */
								__( 'WordPress version: %s' ),
								wpVersion
							)
						);
					}
					wpVersion = matchedVersion.value;
				} catch {
					// If we can't fetch versions (network issue), let it proceed and fail later
				}
			}

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
									name: __( 'Latest (recommended)' ),
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
							choices: SupportedPHPVersions.map( ( v ) => ( {
								name: v === RecommendedPHPVersion ? sprintf( __( '%s (recommended)' ), v ) : v,
								value: v,
							} ) ),
							default: RecommendedPHPVersion,
						} );
					}

					if ( ! customDomain ) {
						const cliConfig = await readCliConfig();
						const existingDomains = cliConfig.sites
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

					if ( ! adminUsername ) {
						adminUsername = await input( {
							message: __( 'Admin username:' ),
							default: 'admin',
							validate: ( value ) => validateAdminUsername( value ) || true,
						} );
					}

					if ( ! adminPassword ) {
						adminPassword = await password( {
							message: __( 'Admin password (leave empty to auto-generate):' ),
							mask: true,
						} );
						if ( ! adminPassword ) {
							adminPassword = undefined;
						}
					}

					if ( ! adminEmail ) {
						adminEmail = await input( {
							message: __( 'Admin email:' ),
							default: 'admin@localhost.com',
							validate: ( value ) => validateAdminEmail( value ) || true,
						} );
					}
				}
			} catch {
				// User cancelled the prompt (Ctrl+C)
				return;
			}

			// Apply defaults for non-interactive mode when flags weren't provided
			wpVersion = wpVersion ?? DEFAULT_WORDPRESS_VERSION;

			const config: CreateCommandOptions = {
				name: siteName,
				siteId: argv.id,
				wpVersion,
				phpVersion: phpVersion ?? RecommendedPHPVersion,
				runtime,
				fileAccess,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
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

					// When invoked by the desktop app, the blueprint contents come from a temp file
					// but resources should be resolved relative to the original file location.
					// For gallery blueprints the path is a URL; use it directly.
					if ( argv.originalBlueprintPath ) {
						const originalPath = argv.originalBlueprintPath;
						config.blueprint.uri =
							originalPath.startsWith( 'http://' ) || originalPath.startsWith( 'https://' )
								? originalPath
								: path.resolve( originalPath );
					}
				}
			}

			try {
				await runCommand( sitePath, config );

				if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
					bumpStat(
						__IS_PACKAGED_FOR_NPM__
							? StatsGroup.STUDIO_CLI_SITE_CREATE_NPM
							: StatsGroup.STUDIO_CLI_SITE_CREATE_APP,
						getPlatformMetric()
					);
				}
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
